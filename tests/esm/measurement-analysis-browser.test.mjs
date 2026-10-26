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
            if (url.pathname === '/parameter-setup.js') {
                const source = await fs.readFile(path.join(root, 'features/measurement/app.js'), 'utf8');
                const section = (first, last) => source.slice(source.indexOf(`function ${first}(`), source.indexOf(`function ${last}(`));
                return route.fulfill({ contentType: 'text/javascript', body:
                    `import { updateRangeFill } from '/js/ui/range-fill.js';
                    import { essFrequencyLimit } from '/features/measurement/measurement-model.js';
                    const INDIVIDUAL_CHANNELS = ['left','right']; export const sweepBandChannelValues = new Map();
                    ${section('sweepBandDefaultValues', 'syncSweepBandChannelChoices')}
                    ${section('loadPEQSettings', 'selectSavedAudioDevices')}
                    ${section('updateSweepFreqLimits', 'updateSweepBandLimitControls')}
                    export { loadPEQSettings, updateSweepFreqLimits };` });
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
            const { installRangePrecisionControl } = await import('/js/ui/range-precision-controller.js');
            installRangePrecisionControl(document);
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
        const parameterAudit = await page.evaluate(async () => {
            const controller = window.analysisFixture.ui.analysisController;
            const settings = structuredClone(controller.settings), refresh = controller.refresh;
            const results = [];
            controller.refresh = () => controller.draw();
            try {
                for (const [tab, variant] of [['frequency', {}], ['impulse', {}], ['impulse', { normalize: false }], ['impulse', { db: true }],
                    ['distortion', {}], ['distortion', { unit: 'dBr', yMin: -80, yMax: 0 }],
                    ['waterfall', {}], ['waterfall', { mode: 'burst', depthUnit: 'seconds' }], ['waterfall', { mode: 'burst', depthUnit: 'cycles' }]]) {
                    for (const [key, input] of Object.entries(controller.controls[tab])) {
                        if (!input.slider) continue;
                        for (const endpoint of ['min', 'max', 'fraction']) {
                            controller.settings = structuredClone(settings); Object.assign(controller.settings[tab], variant);
                            controller.validateSettings(tab); controller.syncControls(tab);
                            input.value = String(endpoint === 'fraction' ? (Number(input.min) + Number(input.max)) / 2 + 0.0001234
                                : Number(input[endpoint]) + (endpoint === 'min' ? -1 : 1));
                            input.dispatchEvent(new Event('input', { bubbles: true }));
                            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
                            const value = controller.settings[tab][key];
                            let nativeStep = null;
                            if (endpoint === 'fraction' && value + Number(input.step) <= Number(input.max)) {
                                input.stepUp(); input.dispatchEvent(new Event('input', { bubbles: true }));
                                input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
                                nativeStep = controller.settings[tab][key] - value;
                                input.stepDown(); input.dispatchEvent(new Event('input', { bubbles: true }));
                                input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
                            }
                            results.push({ name: `${tab}.${JSON.stringify(variant)}.${key}.${endpoint}`, value, number: Number(input.value), applied: input.applied.value,
                                min: Number(input.min), max: Number(input.max), position: Number(input.slider.value), expected: input.toSlider(value),
                                valid: input.validity.valid, nativeStep, step: Number(input.step) });
                        }
                    }
                }
            } finally { controller.settings = settings; controller.refresh = refresh; }
            for (const tab of Object.keys(settings)) { controller.validateSettings(tab); controller.syncControls(tab); }
            await controller.refresh();
            return results;
        });
        assert.equal(parameterAudit.length, 255);
        for (const result of parameterAudit) {
            assert.ok(result.value >= result.min - 1e-9 && result.value <= result.max + 1e-9, `${result.name}: domain`);
            assert.ok(Math.abs(result.number - result.value) <= 0.00051, `${result.name}: number/model`);
            assert.equal(result.applied, result.value, `${result.name}: committed model`);
            assert.ok(Math.abs(result.position - result.expected) < 1e-8, `${result.name}: slider/model`);
            assert.equal(result.valid, true, `${result.name}: native validity`);
            if (result.nativeStep !== null) assert.ok(Math.abs(result.nativeStep - result.step) < 1e-8, `${result.name}: native increment`);
        }
        const smallRatioAudit = await page.evaluate(() => {
            const c = window.analysisFixture.ui.analysisController;
            const saved = { settings: structuredClone(c.settings), record: c.record, peak: c.impulsePeak, refresh: c.refresh, plot: c.currentPlotState, activeTab: c.activeTab };
            const read = tab => ['yMin', 'yMax'].map(key => {
                const input = c.controls[tab][key];
                return { model: c.settings[tab][key], number: Number(input.value), applied: input.applied.value,
                    domain: c.controlRange(tab, key), position: Number(input.slider.value), expected: input.toSlider(c.settings[tab][key]),
                    valid: input.validity.valid };
            });
            c.refresh = () => {};
            try {
                c.record = { ...c.record, data: new Float32Array(512), refScale: 1 };
                c.record.data[16] = 1e-6; c.impulsePeak = c.record.data[16];
                c.settings.impulse.normalize = false; c.activeTab = 'impulse';
                c.currentPlotState = { ...c.settings.impulse, type: 'impulse', unit: '×', targetKey: c.targetKey };
                c.autoRange('impulse');
                const raw = read('impulse');
                c.activeTab = 'distortion';
                c.currentPlotState = { ...c.settings.distortion, type: 'distortion', targetKey: c.targetKey,
                    series: [{ points: [[20, 0.000123], [1000, 0.000234]] }] };
                c.autoRange('distortion'); const percent = read('distortion');
                return { raw, percent };
            } finally {
                Object.assign(c, { settings: saved.settings, record: saved.record, impulsePeak: saved.peak, refresh: saved.refresh, currentPlotState: saved.plot, activeTab: saved.activeTab });
                for (const tab of Object.keys(c.settings)) c.syncControls(tab);
            }
        });
        for (const controls of Object.values(smallRatioAudit)) for (const control of controls) {
            assert.equal(control.number, control.model); assert.equal(control.applied, control.model);
            assert.equal(control.valid, true); assert.ok(Math.abs(control.position - control.expected) < 1e-8);
        }
        assert.ok(smallRatioAudit.raw[1].domain[1] <= 2e-6 && smallRatioAudit.raw[1].domain[1] > 1e-6);
        assert.ok(smallRatioAudit.raw[1].model >= 1e-6 && smallRatioAudit.raw[1].model < 2e-6);
        assert.ok(smallRatioAudit.percent[0].model < 0.000123 && smallRatioAudit.percent[1].model > 0.000234);
        assert.ok(smallRatioAudit.percent[1].model < 0.001);
        const setupAudit = await page.evaluate(async () => {
            const { updateSweepFreqLimits, loadPEQSettings, sweepBandChannelValues } = await import('/parameter-setup.js');
            const { resolveSweepBand } = await import('/features/measurement/measurement-model.js');
            const readPair = () => ['sweepMinFreq', 'sweepMaxFreq'].map(id => Number(document.getElementById(id).value));
            document.getElementById('sampleRate').value = '44100';
            document.getElementById('sweepMinFreq').value = '30000'; document.getElementById('sweepMaxFreq').value = '-1';
            updateSweepFreqLimits(); const low = readPair();
            document.getElementById('sweepMinFreq').value = '20.3'; document.getElementById('sweepMaxFreq').value = '99999';
            sweepBandChannelValues.set('left', { minFreq: 30000, maxFreq: 40000 });
            updateSweepFreqLimits(); const high = readPair(), channel = sweepBandChannelValues.get('left');
            const endpointBands = [44100, 48000, 192000].map(sampleRate => {
                document.getElementById('sampleRate').value = String(sampleRate);
                document.getElementById('sweepMinFreq').value = String(sampleRate / 2 - 200);
                document.getElementById('sweepMaxFreq').value = String(sampleRate / 2 - 1);
                updateSweepFreqLimits();
                const pair = readPair();
                const band = resolveSweepBand({ acquisitionMethod: 'ess', sweepBand: { mode: 'common',
                    common: { minFreq: pair[0], maxFreq: pair[1] } } }, 'left', sampleRate, 131072);
                return { pair, resolved: [band.minFreq, band.maxFreq] };
            });
            const ui = window.analysisFixture.ui, selected = ui.selectedMeasurementId;
            const saved = { smoothing: 0.17, lowFreq: ui.valueToLogSlider(75, 20, 1000), highFreq: ui.valueToLogSlider(12345, 1000, 20000), eqBandCount: 9 };
            const previousApp = window.app;
            ui.selectedMeasurementId = null;
            window.app = { uiManager: ui, dataStorage: { loadPEQSettings: () => saved } };
            try { loadPEQSettings(); } finally { window.app = previousApp; ui.selectedMeasurementId = selected; }
            return { low, high, channel, endpointBands, restored: ['smoothingValue', 'targetLowFreqValue', 'targetHighFreqValue', 'eqBandCountValue'].map(id => {
                const input = document.getElementById(id); return [Number(input.value), input.applied.value];
            }) };
        });
        assert.deepEqual(setupAudit.low, [1, 2]);
        assert.deepEqual(setupAudit.high, [20, 21609]);
        assert.deepEqual(setupAudit.channel, { minFreq: 21608, maxFreq: 21609 });
        for (const band of setupAudit.endpointBands) assert.deepEqual(band.pair, band.resolved);
        assert.deepEqual(setupAudit.restored, [[0.17, 0.17], [75, 75], [12345, 12345], [9, 9]]);
        const correctionFractions = await page.evaluate(() => {
            const ui = window.analysisFixture.ui, handler = ui.correctionHandler;
            const request = handler.requestCorrectionUpdate;
            handler.requestCorrectionUpdate = () => {};
            try {
                return [['targetLowFreqValue', '75.6'], ['targetHighFreqValue', '12345.6'], ['smoothingValue', '0.171'], ['eqBandCountValue', '5.5']].map(([id, value]) => {
                    const input = document.getElementById(id); input.focus(); input.value = value;
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
                    input.dispatchEvent(new Event('blur'));
                    const settings = handler.getTargetSettings();
                    return { id, value: Number(input.value), applied: input.applied.value, settings };
                });
            } finally { handler.requestCorrectionUpdate = request; }
        });
        for (const [index, field] of ['lowFreq', 'highFreq', 'smoothing', 'eqBandCount'].entries()) {
            const result = correctionFractions[index], expected = [76, 12346, 0.17, 6][index];
            assert.equal(result.value, expected); assert.equal(result.applied, expected);
            assert.ok(Math.abs(result.settings[field] - expected) < 1e-8);
        }
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
                if (tab !== 'details') {
                    const actions = page.locator(`#${tab}AnalysisActions`);
                    assert.deepEqual(await actions.locator('button').evaluateAll(buttons => buttons.map(button =>
                        button.classList.contains('analysis-auto-button') ? 'auto' : button.classList.contains('analysis-view-reset-button') ? 'view' :
                            button.classList.contains('analysis-reset-button') ? 'reset' : 'camera')), tab === 'waterfall' ? ['auto', 'view', 'reset', 'camera'] : ['auto', 'reset', 'camera']);
                    assert.equal(await actions.locator('.analysis-reset-button svg path').count(), 2);
                    await actions.getByRole('button', { name: 'Auto range', exact: true }).click();
                    await page.waitForFunction(tab => document.getElementById(`${tab}AnalysisPanel`).getAttribute('aria-busy') !== 'true', tab);
                    if (tab === 'waterfall') {
                        const beforeViewReset = await page.evaluate(() => {
                            const c = window.analysisFixture.ui.analysisController;
                            const settings = structuredClone(c.settings.waterfall), serial = c.worker.serial;
                            Object.assign(c.settings.waterfall, { angle: 90, elevation: 60, zoom: 2 });
                            c.syncControls('waterfall'); c.draw();
                            return { settings, serial };
                        });
                        await actions.getByRole('button', { name: 'Reset view', exact: true }).click();
                        const afterViewReset = await page.evaluate(async () => {
                            const c = window.analysisFixture.ui.analysisController;
                            const { WATERFALL_VIEW_DEFAULTS } = await import('/features/measurement/ui/waterfall-surface.js');
                            return { settings: c.settings.waterfall, serial: c.worker.serial, defaults: WATERFALL_VIEW_DEFAULTS };
                        });
                        assert.deepEqual(afterViewReset.settings, { ...beforeViewReset.settings, ...afterViewReset.defaults });
                        assert.equal(afterViewReset.serial, beforeViewReset.serial);
                    }
                    await actions.getByRole('button', { name: 'Reset', exact: true }).click();
                    await page.waitForFunction(tab => document.getElementById(`${tab}AnalysisPanel`).getAttribute('aria-busy') !== 'true', tab);
                    assert.equal(await page.locator(`#${tab}AnalysisSettings .analysis-setting-actions`).count(), 0);
                }
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
        const pendingGenerations = await page.evaluate(async () => {
            const c = window.analysisFixture.ui.analysisController, plot = c.plots.frequency;
            const originalRun = c.worker.run, originalAfter = c.settings.frequency.after, originalYMax = c.settings.frequency.yMax;
            const jobs = [];
            c.worker.run = function (...args) {
                const result = originalRun.apply(this, args);
                const gate = new Promise(resolve => jobs.push({ release: resolve }));
                return Promise.all([result, gate]).then(([value]) => value);
            };
            const picture = () => ({ pixels: plot.canvas.toDataURL(), conditions: document.getElementById('frequencyAnalysisConditions').textContent,
                status: document.getElementById('frequencyAnalysisStatus').textContent,
                visible: getComputedStyle(document.getElementById('frequencyAnalysisConditions')).visibility });
            const before = picture(), state = plot.state;
            const waitForJob = async count => {
                for (let attempt = 0; jobs.length < count && attempt < 100; attempt++) await new Promise(resolve => setTimeout(resolve, 0));
                if (jobs.length < count) throw new Error('Expected analysis job did not start');
            };
            try {
                c.cache.clear(); c.settings.frequency.after = originalAfter + 1;
                const first = c.refresh();
                await waitForJob(1);
                const level = c.controls.frequency.yMax;
                level.value = originalYMax + 1;
                level.dispatchEvent(new Event('input', { bubbles: true }));
                level.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
                const retained = picture();
                const disabled = document.getElementById('frequencyCopyGraph').disabled && !c.copySnapshots.frequency;
                c.settings.frequency.after = originalAfter + 2;
                const second = c.refresh();
                await waitForJob(2);
                jobs[0].release(); await first;
                const staleDiscarded = plot.state === state && c.readyGeneration === null;
                jobs[1].release(); await second;
                return { retained: JSON.stringify(retained) === JSON.stringify(before), disabled, staleDiscarded,
                    current: plot.state.after === originalAfter + 2 && plot.state.yMax === originalYMax + 1 && c.readyGeneration === c.generation,
                    exportCurrent: c.copySnapshots.frequency?.state === plot.state && !document.getElementById('frequencyCopyGraph').disabled };
            } finally {
                for (const job of jobs) job.release();
                c.worker.run = originalRun; c.settings.frequency.after = originalAfter; c.settings.frequency.yMax = originalYMax;
                await c.refresh();
            }
        });
        assert.deepEqual(pendingGenerations, { retained: true, disabled: true, staleDiscarded: true, current: true, exportCurrent: true });
        await page.locator('#analysis-frequency-source').selectOption('saved');
        await page.locator('#impulseAnalysisTab').click();
        await page.locator('#exportImpulseResponseWav').click();
        assert.deepEqual(await page.evaluate(() => window.exportedIR), { original: true, rate: 8000, length: 4096 });
        await page.locator('#distortionAnalysisTab').click();
        await page.waitForFunction(() => window.analysisFixture.ui.analysisController.analysisResult?.maxOrder === 3);
        const pendingAuto = await page.evaluate(async () => {
            const c = window.analysisFixture.ui.analysisController, settings = structuredClone(c.settings.distortion);
            const originalRun = c.worker.run;
            let release, entered;
            const started = new Promise(resolve => { entered = resolve; });
            const gate = new Promise(resolve => { release = resolve; });
            c.worker.run = function (...args) { entered(); return Promise.all([originalRun.apply(this, args), gate]).then(([result]) => result); };
            try {
                c.cache.clear(); c.settings.distortion.after = 19;
                const refreshing = c.refresh(); await started;
                const unit = c.controls.distortion.unit; unit.value = 'dBr'; unit.dispatchEvent(new Event('change'));
                const before = JSON.stringify(c.settings.distortion), serial = c.worker.serial;
                const button = document.getElementById('distortionAutoRange');
                const disabled = button.disabled;
                button.click(); c.autoRange('distortion');
                const blocked = JSON.stringify(c.settings.distortion) === before && c.worker.serial === serial && c.currentPlotState.unit === '%';
                release(); await refreshing;
                const recovered = !button.disabled && c.currentPlotState.unit === 'dBr';
                c.autoRange('distortion'); await c.refresh();
                const values = c.currentPlotState.series.flatMap(series => series.points.map(point => point[1])).filter(Number.isFinite);
                return { disabled, blocked, recovered, fitted: values.every(value => value >= c.settings.distortion.yMin && value <= c.settings.distortion.yMax),
                    negative: c.settings.distortion.yMax < 0 };
            } finally {
                release(); c.worker.run = originalRun; c.settings.distortion = settings; c.syncControls('distortion'); await c.refresh();
            }
        });
        assert.deepEqual(pendingAuto, { disabled: true, blocked: true, recovered: true, fitted: true, negative: true });
        const unitSerial = await page.evaluate(() => window.analysisFixture.ui.analysisController.worker.serial);
        const levelControls = () => page.evaluate(() => {
            const controller = window.analysisFixture.ui.analysisController;
            return ['yMin', 'yMax'].map(key => {
                const input = controller.controls.distortion[key], slider = input.slider;
                return { value: controller.settings.distortion[key], number: Number(input.value), position: Number(slider.value),
                    min: slider.min, max: slider.max, step: slider.step, numberStep: input.step,
                    fillOrigin: slider.style.getPropertyValue('--et-range-origin') };
            });
        });
        const initialPercent = await levelControls();
        assert.deepEqual(initialPercent.map(control => control.value), [0, 10]);
        assert.equal(initialPercent[0].position, 0);
        for (const [index, control] of initialPercent.entries()) {
            assert.deepEqual([control.min, control.max, control.step, control.numberStep, control.fillOrigin], ['0', '100', 'any', index ? '1' : '0.1', '0%']);
        }
        const fineSlider = page.locator('#analysis-distortion-yMax-slider');
        await fineSlider.scrollIntoViewIfNeeded();
        const fineBox = await fineSlider.boundingBox();
        await page.keyboard.down('Shift');
        try {
            await page.mouse.move(fineBox.x + fineBox.width / 2, fineBox.y + fineBox.height / 2);
            await page.mouse.down();
            await page.mouse.move(fineBox.x + fineBox.width / 2 + 20, fineBox.y + fineBox.height / 2);
            await page.mouse.up();
        } finally { await page.keyboard.up('Shift'); }
        assert.equal((await levelControls())[1].value, 15);
        await page.setViewportSize({ width: 1450, height: 1100 });
        await page.evaluate(() => {
            document.documentElement.classList.remove('layout-mobile'); document.body.classList.remove('layout-mobile');
        });
        const percentNumber = page.locator('#analysis-distortion-yMax');
        const spinUp = async input => {
            await input.hover(); const box = await input.boundingBox();
            await page.mouse.click(box.x + box.width - 8, box.y + box.height / 4);
            await input.press('Enter');
        };
        await spinUp(percentNumber);
        assert.equal((await levelControls())[1].value, 16);
        await percentNumber.fill('10.05'); await percentNumber.press('Enter');
        assert.equal(await percentNumber.evaluate(input => input.validity.valid), true);
        await spinUp(percentNumber); await percentNumber.press('Tab');
        assert.equal((await levelControls())[1].value, 11.05);
        assert.equal(await percentNumber.evaluate(input => input.applied.value), 11.05);
        await percentNumber.fill('10'); await percentNumber.press('Enter');
        await percentNumber.press('ArrowUp'); await percentNumber.press('Enter');
        assert.equal((await levelControls())[1].value, 11);
        assert.equal(await percentNumber.evaluate(input => input.validity.valid), true);
        await percentNumber.press('ArrowDown'); await percentNumber.press('Enter');
        assert.equal((await levelControls())[1].value, 10);
        for (const [value, incremented] of [['0.000123', '0.000133'], ['1.23e-7', '1.33e-7']]) {
            await percentNumber.fill(value); await percentNumber.press('Enter');
            await spinUp(percentNumber); await percentNumber.press('Tab');
            assert.equal(Number(await percentNumber.inputValue()), Number(incremented));
            assert.equal(await percentNumber.evaluate(input => input.validity.valid), true);
            assert.equal(await percentNumber.evaluate(input => input.applied.value), Number(incremented));
        }
        await page.setViewportSize({ width: 430, height: 1000 });
        await page.evaluate(() => {
            document.documentElement.classList.add('layout-mobile'); document.body.classList.add('layout-mobile');
        });
        const decadePositions = [];
        for (const value of ['1e-7', '0.000001', '0.00001', '0.0001', '0.001', '0.01', '0.1', '1', '10', '180']) {
            await page.locator('#analysis-distortion-yMax').fill(value);
            await page.locator('#analysis-distortion-yMax').press('Enter');
            const [, upper] = await levelControls();
            assert.equal(upper.value, Number(value)); assert.equal(upper.number, Number(value));
            decadePositions.push(upper.position);
        }
        assert.ok(Math.abs(decadePositions[0] - 0.1) < 1e-10);
        assert.ok(Math.abs(decadePositions[9] - 100) < 1e-10);
        for (let index = 2; index < 9; index++) {
            assert.ok(Math.abs(decadePositions[index] - decadePositions[index - 1] - (decadePositions[1] - decadePositions[0])) < 1e-8);
        }
        for (const key of ['yMin', 'yMax']) {
            await page.locator(`#analysis-distortion-${key}-slider`).evaluate(slider => {
                slider.value = 100; slider.dispatchEvent(new Event('input', { bubbles: true }));
            });
        }
        assert.deepEqual((await levelControls()).map(control => control.value), [179.99, 180]);
        assert.ok((await levelControls()).every(control => control.max === '100'));
        await page.locator('#analysis-distortion-yMin-slider').focus(); await page.keyboard.press('Home');
        assert.equal((await levelControls())[0].value, 0);
        await page.keyboard.press('ArrowRight');
        assert.ok((await levelControls())[0].value > 0);
        const firstPositive = (await levelControls())[0].value;
        await page.keyboard.press('ArrowRight');
        assert.ok((await levelControls())[0].value > firstPositive);
        await page.keyboard.press('Home');
        await page.locator('#analysis-distortion-yMax-slider').focus(); await page.keyboard.press('Home');
        assert.deepEqual((await levelControls()).map(control => control.value), [0, 1e-7]);
        await page.locator('#analysis-distortion-yMin').fill('-10');
        await page.locator('#analysis-distortion-yMin').press('Enter');
        assert.equal((await levelControls())[0].number, 0);
        const smallAxis = await page.evaluate(() => {
            const controller = window.analysisFixture.ui.analysisController;
            Object.assign(controller.settings.distortion, { yMin: 0, yMax: 0.000001 });
            controller.validateSettings('distortion'); controller.syncControls('distortion');
            const ctx = controller.plots.distortion.canvas.getContext('2d');
            const original = ctx.fillText, labels = [];
            ctx.fillText = function(text, x, y, ...rest) {
                if (this.textAlign === 'right') labels.push({ text, left: x - this.measureText(text).width });
                return original.call(this, text, x, y, ...rest);
            };
            try { controller.draw(); } finally { ctx.fillText = original; }
            return labels;
        });
        assert.ok(smallAxis.length > 0);
        assert.ok(smallAxis.every(label => label.left >= 0), JSON.stringify(smallAxis));
        await page.locator('#analysis-distortion-unit').focus();
        await page.evaluate(() => window.analysisFixture.ui.analysisController.autoRange('distortion'));
        await page.waitForFunction(() => document.getElementById('distortionAnalysisPanel').getAttribute('aria-busy') !== 'true');
        const autoPercent = await levelControls();
        assert.ok(autoPercent[0].value >= 0 && autoPercent[0].value < autoPercent[1].value);
        for (const control of autoPercent) {
            const expected = control.value <= 0 ? 0 : 0.1 + 99.9 * Math.log(Math.max(1e-7, control.value) / 1e-7) / Math.log(180 / 1e-7);
            assert.ok(Math.abs(control.position - expected) < 1e-8);
        }
        await page.locator('#analysis-distortion-unit').selectOption('dBr');
        assert.equal(await page.evaluate(() => window.analysisFixture.ui.analysisController.worker.serial), unitSerial);
        for (const [index, control] of (await levelControls()).entries()) {
            assert.deepEqual([control.value, control.position, control.min, control.max, control.step],
                index === 0 ? [-80, -80, '-180', '179.9', 'any'] : [0, 0, '-79.9', '180', 'any']);
            assert.equal(control.numberStep, '1');
        }
        await percentNumber.fill('-20.1'); await percentNumber.press('Enter');
        assert.equal(await percentNumber.inputValue(), '-20.1', JSON.stringify(await levelControls()));
        await percentNumber.press('ArrowUp'); await percentNumber.press('Enter');
        assert.equal(await percentNumber.inputValue(), '-19.1');
        await page.setViewportSize({ width: 1450, height: 1100 });
        await page.evaluate(() => {
            document.documentElement.classList.remove('layout-mobile'); document.body.classList.remove('layout-mobile');
        });
        await spinUp(percentNumber);
        assert.equal(await percentNumber.inputValue(), '-18.1');
        assert.equal(await percentNumber.evaluate(input => input.validity.valid), true);
        await page.locator('#analysis-distortion-yMin').fill('-18.2');
        await page.locator('#analysis-distortion-yMin').press('Enter');
        assert.deepEqual((await levelControls()).map(control => control.value), [-18.2, -18.1]);
        await percentNumber.fill('0'); await percentNumber.press('Enter');
        await page.setViewportSize({ width: 430, height: 1000 });
        await page.evaluate(() => {
            document.documentElement.classList.add('layout-mobile'); document.body.classList.add('layout-mobile');
        });
        await page.locator('#analysis-distortion-yMin').fill('-120');
        await page.locator('#analysis-distortion-yMin').press('Enter');
        assert.deepEqual((await levelControls()).map(control => control.value), [-120, 0]);
        await page.locator('#analysis-distortion-unit').selectOption('%');
        assert.deepEqual((await levelControls()).map(control => control.value), [0, 10]);
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
        assert.equal(await page.locator('#analysis-distortion-harmonicLimit-slider').getAttribute('max'), '3');
        assert.equal(await page.locator('#distortionHarmonicsNote').isVisible(), true);
        await page.locator('#analysis-distortion-harmonicLimit').fill('10');
        await page.locator('#analysis-distortion-harmonicLimit').press('Enter');
        assert.equal(await page.locator('#analysis-distortion-harmonicLimit').inputValue(), '3');
        await page.evaluate(async () => {
            const fixture = window.analysisFixture, controller = fixture.ui.analysisController;
            fixture.originalOrders = fixture.record.harmonicAnalysis.orders;
            fixture.record.harmonicAnalysis.orders = [...fixture.originalOrders, ...Array.from({ length: 7 }, (_, index) => {
                const order = index + 4, data = new Float32Array(80), referenceData = new Float32Array(80);
                const harmonicReferenceData = new Float32Array(80);
                data[8] = 0.01 / order; harmonicReferenceData[8] = 1;
                return { order, data, referenceData, harmonicReferenceData, onsetIndex: 8,
                    validMinFrequency: 22, validMaxFrequency: 3150 / order };
            })];
            controller.cache.clear(); controller.loadedRecordKey = null;
            await controller.refresh();
        });
        assert.equal(await page.locator('#analysis-distortion-harmonicLimit-slider').getAttribute('max'), '10');
        assert.equal(await page.locator('#distortionHarmonicsNote').isVisible(), false);
        assert.equal(await page.locator('#analysis-distortion-after').inputValue(), '20');
        await page.locator('#analysis-distortion-harmonicLimit-slider').evaluate(slider => {
            slider.value = '10'; slider.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await page.waitForFunction(() => window.analysisFixture.ui.analysisController.analysisResult?.harmonicLimit === 10);
        const highOrders = await page.evaluate(() => {
            const controller = window.analysisFixture.ui.analysisController;
            const plot = controller.plots.distortion;
            const readout = plot.read(plot.scaleX(200), plot.plot.top);
            return { limit: controller.settings.distortion.harmonicLimit, thd: controller.settings.distortion.maxOrder,
                before: controller.settings.distortion.before, after: controller.settings.distortion.after,
                labels: controller.currentPlotState.series.map(series => series.label),
                thdOptions: [...controller.controls.distortion.maxOrder.options].map(option => option.value),
                rows: readout.rows, subtitle: controller.copySnapshots.distortion.subtitle,
                highestFinite: controller.currentPlotState.series.at(-1).points.some(([, value]) => Number.isFinite(value)) };
        });
        assert.equal(highOrders.limit, 10);
        assert.equal(highOrders.thd, 3, 'raising display limit does not silently raise THD ceiling');
        assert.deepEqual([highOrders.before, highOrders.after], [1, 9]);
        assert.deepEqual(highOrders.labels, ['THD (2–3)', ...Array.from({ length: 9 }, (_, i) => `H${i + 2}`)]);
        assert.deepEqual(highOrders.thdOptions, ['2', '3', '4', '5', '6', '7', '8', '9', '10']);
        assert.equal(highOrders.highestFinite, true);
        assert.ok(highOrders.rows.every(row => row.label.includes('dBr')));
        assert.match(highOrders.subtitle, /2–10.*2–3.*dBr/);
        const hannSerial = await page.evaluate(() => window.analysisFixture.ui.analysisController.worker.serial);
        await page.locator('#analysis-distortion-window').selectOption('hann');
        await page.waitForFunction(serial => {
            const controller = window.analysisFixture.ui.analysisController;
            return controller.worker.serial > serial && controller.readyGeneration === controller.generation;
        }, hannSerial);
        const hannRatios = await page.evaluate(() => window.analysisFixture.ui.analysisController.analysisResult.series.map(series => ({
            order: series.order, ratios: series.ratios.filter(Number.isFinite)
        })));
        assert.equal(hannRatios.length, 9);
        for (const { order, ratios } of hannRatios) {
            const expected = order === 2 ? 0.01 : order === 3 ? 0.003 : 0.01 / order;
            assert.ok(ratios.length > 0 && ratios.every(ratio => Math.abs(ratio - expected) < 1e-6), `H${order} Hann ratio`);
        }
        await page.locator('#analysis-distortion-maxOrder').selectOption('10');
        await page.waitForFunction(() => window.analysisFixture.ui.analysisController.analysisResult?.maxOrder === 10);
        const exportDb = await page.evaluate(async () => {
            const controller = window.analysisFixture.ui.analysisController;
            const serial = controller.worker.serial;
            const saved = controller.analysisResult;
            controller.autoRange('distortion'); await controller.refresh();
            const range = [controller.settings.distortion.yMin, controller.settings.distortion.yMax];
            const originalText = CanvasRenderingContext2D.prototype.fillText, texts = [];
            CanvasRenderingContext2D.prototype.fillText = function(text, ...args) { texts.push(String(text)); return originalText.call(this, text, ...args); };
            let bytes;
            const oldBridge = window.electronAPI;
            window.electronAPI = { writeClipboardImage: async value => { bytes = value; return true; } };
            try { await controller.copyImage('distortion'); }
            finally { CanvasRenderingContext2D.prototype.fillText = originalText; window.electronAPI = oldBridge; }
            const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
            const result = { serialUnchanged: controller.worker.serial === serial, sameRatios: saved === controller.analysisResult,
                text: texts.join(' '), range, width: image.width, height: image.height, bytes: bytes.length };
            image.close(); return result;
        });
        assert.equal(exportDb.serialUnchanged, true);
        assert.equal(exportDb.sameRatios, true);
        assert.ok(exportDb.range.every(Number.isFinite) && exportDb.range[0] < exportDb.range[1]);
        assert.match(exportDb.text, /H10 \(dBr\)/);
        assert.match(exportDb.text, /THD \(2–10\) \(dBr\)/);
        assert.ok(exportDb.width >= 1600 && exportDb.height > 0 && exportDb.bytes > 1000);
        if (screenshotDir) await page.locator('#measurementResults').screenshot({ path: path.join(screenshotDir, 'narrow-en-h10-dbr.png') });
        await page.locator('#analysis-distortion-harmonicLimit-slider').evaluate(slider => {
            slider.value = '2'; slider.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await page.waitForFunction(() => window.analysisFixture.ui.analysisController.analysisResult?.harmonicLimit === 2);
        assert.equal(await page.locator('#analysis-distortion-maxOrder').inputValue(), '2');
        assert.equal(await page.locator('#analysis-distortion-h3').isVisible(), false);
        await page.evaluate(async () => {
            const fixture = window.analysisFixture, controller = fixture.ui.analysisController;
            fixture.record.harmonicAnalysis.orders = fixture.originalOrders;
            controller.cache.clear(); controller.reset('distortion'); await controller.refresh();
        });
        assert.equal(await page.locator('#analysis-distortion-unit').inputValue(), '%');
        assert.deepEqual((await levelControls()).map(control => control.value), [0, 10]);
        assert.equal((await levelControls())[0].position, 0);
        assert.equal(await page.locator('#analysis-distortion-harmonicLimit').inputValue(), '3');
        assert.equal(await page.locator('#analysis-distortion-maxOrder').inputValue(), '3');
        await page.evaluate(async () => {
            const fixture = window.analysisFixture;
            fixture.record.harmonicAnalysis.quality.valid = false;
            await fixture.i18n.setLanguage('ja');
            document.documentElement.setAttribute('data-theme', 'paper');
            await fixture.ui.analysisController.refresh();
        });
        assert.equal(await page.locator('#distortionAnalysisStatus').textContent(), '');
        assert.equal(await page.locator('#distortionAnalysisGraph').isVisible(), true);
        if (screenshotDir) await page.locator('#measurementResults').screenshot({ path: path.join(screenshotDir, 'narrow-ja-warning-distortion.png') });
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
        const qualityMessages = await page.evaluate(async () => {
            const f = window.analysisFixture, controller = f.ui.analysisController, display = f.ui.measurementDisplay;
            let rightPayload = 'clipped';
            f.storage.getImpulseResponse = async (_id, key) => ({ ...f.record, pointId: key,
                harmonicAnalysis: key === 1 ? { ...f.record.harmonicAnalysis,
                    quality: { valid: false, reasons: ['inconsistent-capture', 'overlapping-tail'] } }
                    : rightPayload === 'missing' ? undefined
                        : { ...f.record.harmonicAnalysis, ...(rightPayload === 'malformed' ? { orders: [] } : {}),
                            quality: { valid: false, reasons: ['clipping'] } } });
            const snapshot = () => ({ channel: controller.target.channel,
                message: document.getElementById('distortionAnalysisStatus').textContent,
                hidden: controller.plots.distortion.mount.hidden,
                copyDisabled: document.getElementById('distortionCopyGraph').disabled,
                available: controller.capabilities.distortion,
                ratios: controller.analysisResult?.series[0].ratios.filter(Number.isFinite) || [],
                quality: controller.record.harmonicAnalysis?.quality,
                subtitle: controller.copySnapshots.distortion?.subtitle || '',
                warning: controller.currentPlotState?.qualityWarning || '' });
            controller.selectTab('distortion'); display.selectChannel('left'); await controller.refresh();
            const left = snapshot();
            const plot = controller.plots.distortion;
            plot.canvas.focus();
            plot.canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
            const readout = document.getElementById('distortionAnalysisReadout').textContent;
            const fillText = CanvasRenderingContext2D.prototype.fillText;
            const priorApi = window.electronAPI;
            const drawnText = [];
            let copiedBytes;
            try {
                CanvasRenderingContext2D.prototype.fillText = function(text, ...args) {
                    drawnText.push(text); return fillText.call(this, text, ...args);
                };
                window.electronAPI = { writeClipboardImage: async bytes => { copiedBytes = bytes; return true; } };
                await controller.copyImage('distortion');
            } finally {
                CanvasRenderingContext2D.prototype.fillText = fillText;
                window.electronAPI = priorApi;
            }
            const bitmap = await createImageBitmap(new Blob([copiedBytes], { type: 'image/png' }));
            const copy = { width: bitmap.width, bytes: copiedBytes.length, text: drawnText.join(''),
                persistentWarning: document.getElementById('distortionAnalysisStatus').textContent };
            bitmap.close();
            await f.i18n.setLanguage('ja'); await controller.refresh();
            const japanese = snapshot();

            display.selectChannel('right'); await controller.refresh();
            const right = snapshot();

            rightPayload = 'missing'; await controller.refresh();
            const missing = snapshot();
            rightPayload = 'malformed'; await controller.refresh();
            const malformed = snapshot();
            const absentExpected = f.i18n.t('analysis:noDistortion');
            rightPayload = 'clipped'; controller.cache.clear();
            const run = controller.worker.run;
            let failed;
            try {
                controller.worker.run = async () => { throw new Error('Fixture analysis cannot be computed'); };
                await controller.refresh(); controller.draw();
                failed = { message: document.getElementById('distortionAnalysisStatus').textContent,
                    cleared: controller.plots.distortion.state === null, copyDisabled: document.getElementById('distortionCopyGraph').disabled };
            } finally { controller.worker.run = run; }
            const failedExpected = f.i18n.t('analysis:failed');
            await f.i18n.setLanguage('en');
            return { left, readout, copy, japanese, right, missing, malformed, absentExpected, failed, failedExpected };
        });
        assert.equal(qualityMessages.left.channel, 'left');
        assert.doesNotMatch(qualityMessages.readout, /may be inaccurate/);
        assert.match(qualityMessages.readout, /H2/);
        assert.doesNotMatch(qualityMessages.copy.text, /These distortion results may be inaccurate/);
        assert.ok(qualityMessages.copy.width >= 1600);
        assert.ok(qualityMessages.copy.bytes > 1000);
        assert.equal(qualityMessages.copy.persistentWarning, qualityMessages.left.message);
        assert.equal(qualityMessages.right.channel, 'right');
        for (const name of ['left', 'japanese', 'right', 'missing', 'malformed']) {
            const state = qualityMessages[name];
            const missing = name === 'missing' || name === 'malformed';
            assert.equal(state.hidden, missing);
            assert.equal(state.copyDisabled, missing);
            assert.equal(state.available, !missing);
            assert.equal(state.ratios.length > 0, !missing);
            if (!missing) {
                assert.equal(state.quality.valid, false);
                assert.ok(state.ratios.every(value => Math.abs(value - 0.01) < 1e-6));
                assert.equal(state.message, '');
                assert.equal(state.warning, '');
                assert.doesNotMatch(state.subtitle, /may be inaccurate/);
                assert.deepEqual(state.quality.reasons, name === 'right' ? ['clipping'] : ['inconsistent-capture', 'overlapping-tail']);
            }
            assert.doesNotMatch(state.message, /inconsistent-capture|overlapping-tail|clipping/);
        }
        assert.equal(qualityMessages.missing.message, qualityMessages.absentExpected);
        assert.equal(qualityMessages.malformed.message, qualityMessages.absentExpected);
        assert.deepEqual(qualityMessages.failed, { message: qualityMessages.failedExpected, cleared: true, copyDisabled: true });
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
            const noPendingExport = captions.length === 1 && plot.state === null && plot.state !== oldState;
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
            const empty = { disabled: button.disabled, count: images.length,
                conditions: document.getElementById('impulseAnalysisConditions').textContent,
                busy: document.getElementById('impulseAnalysisPanel').getAttribute('aria-busy') };
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
        assert.deepEqual(copyRefresh.empty, { disabled: true, count: 2, conditions: '', busy: 'false' });
        await page.evaluate(async () => {
            const f = window.analysisFixture, controller = f.ui.analysisController;
            const { ANALYSIS_DEFAULTS } = await import('/features/measurement/ui/analysis-controller.js');
            const record = { sampleRate: 48000, onsetIndex: 128, refScale: 1, data: new Float32Array(16384) };
            record.data[128] = 1;
            f.storage.getImpulseResponse = async () => record;
            f.storage.measurements = [f.measurement]; f.ui.selectedMeasurementId = f.measurement.id;
            controller.settings.waterfall = structuredClone(ANALYSIS_DEFAULTS.waterfall);
            controller.loadedRecordKey = null; controller.cache.clear();
            controller.selectTab('waterfall'); await controller.refresh();
        });
        await page.setViewportSize({ width: 1450, height: 1100 });
        await page.evaluate(() => {
            document.documentElement.classList.remove('layout-mobile'); document.body.classList.remove('layout-mobile');
        });
        await page.locator('#impulseAnalysisTab').click();
        await page.waitForFunction(() => document.getElementById('impulseAnalysisPanel').getAttribute('aria-busy') !== 'true');
        await page.locator('#impulseAnalysisActions .analysis-reset-button').click();
        await page.waitForFunction(() => document.getElementById('impulseAnalysisPanel').getAttribute('aria-busy') !== 'true');
        const readImpulseView = () => page.evaluate(() => {
            const c = window.analysisFixture.ui.analysisController, s = c.settings.impulse;
            return { min: s.xMin, max: s.xMax, origin: s.origin,
                observedMin: -c.record.onsetIndex * 1000 / c.record.sampleRate - s.origin,
                observedMax: (c.record.data.length - c.record.onsetIndex) * 1000 / c.record.sampleRate - s.origin,
                fields: ['xMin', 'xMax'].map(key => {
                    const input = c.controls.impulse[key];
                    return { value: s[key], number: Number(input.value), applied: input.applied.value,
                        slider: Number(input.slider.value), valid: input.validity.valid };
                }) };
        });
        const assertImpulseView = async () => {
            const view = await readImpulseView();
            for (const field of view.fields) {
                assert.equal(field.number, field.value); assert.equal(field.applied, field.value);
                assert.equal(field.slider, field.value); assert.equal(field.valid, true);
            }
            return view;
        };
        for (let index = 0; index < 5; index++) await page.locator('#impulseResponseZoomOut').click();
        const fullView = await assertImpulseView();
        assert.deepEqual([fullView.min, fullView.max], [-2.67, 338.67]);
        assert.ok(fullView.min <= fullView.observedMin && fullView.max >= fullView.observedMax);
        await page.locator('#impulseResponseZoomIn').click(); await assertImpulseView();
        const irCanvas = page.locator('#impulseResponseGraph'); await irCanvas.hover(); await page.mouse.wheel(0, -100);
        await assertImpulseView();
        const pan = await page.evaluate(() => {
            const c = window.analysisFixture.ui.analysisController, p = c.plots.impulse;
            Object.assign(c.settings.impulse, { yMin: -0.000001, yMax: 0.000001 }); c.validateSettings('impulse'); c.syncControls('impulse'); c.draw();
            const rect = p.canvas.getBoundingClientRect();
            return { start: p.state.xMin, duration: p.state.xMax - p.state.xMin,
                width: p.plot.width * rect.width / p.width, left: p.plot.left };
        });
        const irBox = await irCanvas.boundingBox();
        await page.mouse.move(irBox.x + irBox.width / 2, irBox.y + irBox.height / 2); await page.mouse.down();
        await page.mouse.move(irBox.x + irBox.width / 2 + 50, irBox.y + irBox.height / 2); await page.mouse.up();
        const panned = await assertImpulseView();
        assert.equal(panned.min, Number((pan.start - 50 / pan.width * pan.duration).toFixed(2)));
        const irScroll = page.locator('#impulseResponseScroll');
        await irScroll.focus(); await irScroll.press('End');
        const endView = await assertImpulseView();
        assert.ok(endView.max >= endView.observedMax && endView.max - endView.observedMax < 0.01);
        await irScroll.press('Home');
        const startView = await assertImpulseView();
        assert.ok(startView.min <= startView.observedMin && startView.observedMin - startView.min < 0.01);
        const impulseDetails = page.locator('#impulseAnalysisPanel details');
        if (!(await impulseDetails.evaluate(element => element.open))) await impulseDetails.locator('summary').click();
        await spinUp(page.locator('#analysis-impulse-xMin')); await assertImpulseView();
        await page.locator('#analysis-impulse-xMax').press('ArrowDown');
        await page.locator('#analysis-impulse-xMax').press('Enter'); await assertImpulseView();
        await page.locator('#analysis-impulse-origin').fill('0.123'); await page.locator('#analysis-impulse-origin').press('Enter');
        for (let index = 0; index < 3; index++) await page.locator('#impulseResponseZoomOut').click();
        const shifted = await assertImpulseView();
        assert.equal(shifted.origin, 0.123); assert.ok(shifted.min <= shifted.observedMin && shifted.max >= shifted.observedMax);
        await page.locator('#waterfallAnalysisTab').click();
        await page.waitForFunction(() => document.getElementById('waterfallAnalysisPanel').getAttribute('aria-busy') !== 'true');
        const waitWaterfall = () => page.waitForFunction(() => document.getElementById('waterfallAnalysisPanel').getAttribute('aria-busy') !== 'true');
        const surfaceState = () => page.evaluate(() => {
            const controller = window.analysisFixture.ui.analysisController;
            return { triangles: controller.plots.waterfall.surface.mesh?.triangles.length || 0,
                status: document.getElementById('waterfallAnalysisStatus').textContent,
                copy: !document.getElementById('waterfallCopyGraph').disabled, snapshot: Boolean(controller.copySnapshots.waterfall) };
        });
        const assertDrawable = async () => {
            const state = await surfaceState();
            assert.ok(state.triangles > 0); assert.equal(state.status, ''); assert.equal(state.copy, true); assert.equal(state.snapshot, true);
        };
        const durationNumber = page.locator('#analysis-waterfall-length');
        await durationNumber.fill('100'); await durationNumber.press('Enter'); await waitWaterfall();
        await durationNumber.press('ArrowUp'); await durationNumber.press('Enter'); await waitWaterfall();
        assert.equal(await durationNumber.inputValue(), '101');
        assert.equal(await durationNumber.evaluate(input => input.validity.valid), true);
        await spinUp(durationNumber); await waitWaterfall();
        assert.equal(await durationNumber.inputValue(), '102');
        await page.locator('#analysis-waterfall-length-slider').focus(); await page.keyboard.press('Home'); await waitWaterfall();
        await assertDrawable();
        await page.locator('#analysis-waterfall-start-slider').focus(); await page.keyboard.press('End'); await waitWaterfall();
        await assertDrawable();
        await page.locator('#analysis-waterfall-mode').selectOption('burst'); await waitWaterfall();
        await page.locator('#analysis-waterfall-depthUnit').selectOption('seconds'); await waitWaterfall();
        await page.locator('#analysis-waterfall-start-slider').focus(); await page.keyboard.press('End'); await waitWaterfall();
        await assertDrawable();
        const unavailableRecovery = await page.evaluate(async () => {
            const controller = window.analysisFixture.ui.analysisController, valid = controller.analysisResult;
            const s = controller.settings.waterfall;
            const read = () => ({ status: document.getElementById('waterfallAnalysisStatus').textContent,
                disabled: document.getElementById('waterfallCopyGraph').disabled,
                autoDisabled: document.getElementById('waterfallAutoRange').disabled,
                snapshot: Boolean(controller.copySnapshots.waterfall), cleared: controller.currentPlotState === null });
            controller.analysisResult = await controller.worker.run('waterfall', controller.record,
                { startSeconds: 0, endSeconds: 0.3, windowSeconds: 2 / 48000, riseSeconds: 0, maxSlices: 48 });
            controller.draw(); const empty = read();
            controller.analysisResult = await controller.worker.run('burst', controller.record,
                { depthUnit: 'seconds', startSeconds: 0.338322, endSeconds: 0.338332, minFrequency: 20, maxFrequency: 20000, maxSlices: 48 });
            controller.draw(); const isolated = read();
            controller.analysisResult = valid; s.xMin = 20; s.xMax = 20000; controller.draw();
            return { empty, isolated, recovered: read() };
        });
        for (const state of [unavailableRecovery.empty, unavailableRecovery.isolated]) {
            assert.ok(state.status.length > 0); assert.equal(state.disabled, true); assert.equal(state.autoDisabled, true); assert.equal(state.snapshot, false); assert.equal(state.cleared, true);
        }
        assert.deepEqual(unavailableRecovery.recovered, { status: '', disabled: false, autoDisabled: false, snapshot: true, cleared: false });
        assert.deepEqual(errors, []);
    } finally { await browser.close(); }
});
