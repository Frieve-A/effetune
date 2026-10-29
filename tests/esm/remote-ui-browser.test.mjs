import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { chromium } from 'playwright';
import { applyOps, deepEqual } from '../../js/remote/sync-ops.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const origin = 'https://effetune.test';
const fixture = `<!doctype html><html><head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws:">
    <link rel="stylesheet" href="css/effetune.css">
    <link rel="stylesheet" href="css/effetune-mobile.css">
    <link rel="stylesheet" href="css/effetune-theme.css">
    <link rel="stylesheet" href="css/effetune-remote.css">
    </head><body><button id="opener">Open settings</button></body></html>`;

async function openPage(t, viewport = { width: 1200, height: 900 }) {
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route(`${origin}/**`, async route => {
        const pathname = new URL(route.request().url()).pathname;
        if (pathname === '/') return route.fulfill({ contentType: 'text/html', body: fixture });
        const file = path.resolve(root, `.${pathname}`);
        const relative = path.relative(root, file);
        if (relative.startsWith('..') || path.isAbsolute(relative)) return route.fulfill({ status: 403, body: '' });
        const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json5': 'application/json', '.json': 'application/json', '.wasm': 'application/wasm' };
        await route.fulfill({ contentType: types[path.extname(file)], body: await fs.readFile(file) });
    });
    await page.goto(origin);
    return { page, errors };
}

for (const width of [390, 1280]) {
    test(`remote editor hides unfinished markup during startup at ${width}px`, async t => {
        const { page, errors } = await openPage(t, { width, height: 850 });
        const scriptGate = Promise.withResolvers();
        const pluginsGate = Promise.withResolvers();
        const pluginsRequested = Promise.withResolvers();
        t.after(() => { scriptGate.resolve(); pluginsGate.resolve(); });
        await page.route('**/js/remote/remote-client.js', async route => {
            await scriptGate.promise;
            await route.fallback();
        });
        await page.route('**/plugins/plugins.txt', async route => {
            pluginsRequested.resolve();
            await pluginsGate.promise;
            await route.fallback();
        });
        await page.evaluate(async () => {
            const { IntegratedRemoteEffects } = await import('./js/remote/integrated-remote-effects.js');
            const container = document.createElement('section');
            document.body.replaceChildren(container);
            let listener;
            const api = {
                getConnection: async () => ({ registered: true }),
                onEvent: callback => { listener = callback; return () => {}; },
                connect: async () => {
                    listener({ type: 'open', connectionId: 'fixture' });
                    return { ok: true, connectionId: 'fixture' };
                },
                send: async (connectionId, raw) => {
                    const message = JSON.parse(raw);
                    listener({ type: 'message', connectionId, data: JSON.stringify({ op: 'ack', seq: message.seq, ok: true }) });
                    return true;
                },
                disconnect: async () => {}
            };
            window.uiManager = { layoutMode: { isMobile: innerWidth < 1159 } };
            window.effects = new IntegratedRemoteEffects({ container, api });
            await effects.selectPlayer({ id: 'fixture', name: 'Test player' });
            Object.assign(effects.frame.style, { width: '100%', height: '750px', border: '0' });
        });
        const frame = page.frames().find(candidate => candidate.parentFrame());
        await frame.locator('.remote-status').waitFor({ state: 'visible' });
        assert.equal(await frame.locator('.main-container').isVisible(), false, 'before module execution');
        assert.equal(await frame.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        scriptGate.resolve();
        await pluginsRequested.promise;
        assert.equal(await frame.locator('.main-container').isVisible(), false, 'while plugins load');
        assert.equal(await frame.locator('.remote-status').textContent(), 'Connecting…');
        pluginsGate.resolve();
        await frame.waitForFunction(() => window.remoteClient?.session.status === 'open');
        assert.equal(await frame.locator('.main-container').isVisible(), true);
        assert.equal(await frame.evaluate(() => uiManager.layoutMode.mode), width === 390 ? 'mobile' : 'desktop');
        if (width === 390) {
            assert.equal(await frame.locator('#pluginList').isVisible(), false);
            assert.equal(await frame.locator('.mobile-plugin-fab').isVisible(), true);
            assert.equal(await frame.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        }
        assert.deepEqual(errors, []);
        await page.evaluate(() => effects.dispose());
    });
}

async function openDialog(t, { language = 'en', viewport } = {}) {
    const { page, errors } = await openPage(t, viewport);
    await page.evaluate(async language => {
        const { RemoteControlDialog } = await import('./js/remote/remote-control-dialog.js');
        const { createRemoteUiManager, loadTranslations } = await import('./js/remote/remote-ui-manager.js');
        window.uiManager = createRemoteUiManager(await loadTranslations({ language }));
        window.calls = [];
        window.statusListeners = new Set();
        window.makeAddress = (address, token = 'pairing-code') => ({
            address, name: 'Ethernet', webUrl: `http://${address}:47300/?t=${token}`,
            webQr: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M10 10h80v80H10z"/></svg>')
        });
        window.remoteStatus = {
            enabled: false, running: false, clients: 0, port: 47300,
            addresses: [makeAddress('192.168.0.5')], devices: []
        };
        window.pushStatus = patch => {
            Object.assign(remoteStatus, patch);
            for (const listener of statusListeners) listener(structuredClone(remoteStatus));
        };
        const api = {
            getStatus: async () => structuredClone(remoteStatus),
            onStatus: callback => { statusListeners.add(callback); return () => statusListeners.delete(callback); },
            setEnabled: async enabled => {
                calls.push(['enabled', enabled]);
                if (window.permissionFails) throw new Error('internal permission save failure');
                pushStatus({ enabled, running: enabled });
                return structuredClone(remoteStatus);
            },
            regenerateToken: async () => {
                calls.push(['token']);
                pushStatus({ addresses: remoteStatus.addresses.map(address => makeAddress(address.address, 'new-code')) });
                return structuredClone(remoteStatus);
            },
            copyLink: async index => { calls.push(['copy', index]); return !window.copyFails; },
            join: async input => { calls.push(['join', input]); return { ok: !window.joinFails, error: 'internal-details' }; }
        };
        window.remoteSettingsApi = api;
        window.dialog = new RemoteControlDialog(window, api);
        document.getElementById('opener').focus();
        dialog.show();
    }, language);
    await page.waitForFunction(() => !document.getElementById('remote-control-enabled').disabled);
    return { page, errors };
}

test('remote settings overlay follows the app theme, fits the window, and keeps keyboard focus inside', { timeout: 30000 }, async t => {
    const { page, errors } = await openDialog(t, { language: 'ja', viewport: { width: 480, height: 600 } });
    assert.equal(await page.locator('#remote-control-title').textContent(), 'リモートコントロール');
    await page.evaluate(() => dialog.show());
    assert.equal(await page.locator('[role="dialog"]').count(), 1);
    await page.locator('#remote-control-enabled').check();
    const joinLayout = await page.locator('#remote-control-join').evaluate(button => {
        const text = document.createRange();
        text.selectNodeContents(button);
        return { textLines: text.getClientRects().length, button: button.getBoundingClientRect().width,
            row: button.closest('.remote-control-join-row').getBoundingClientRect().width,
            input: document.getElementById('remote-control-join-input').getBoundingClientRect().width };
    });
    assert.equal(joinLayout.textLines, 1);
    assert.ok(joinLayout.button >= 60 && joinLayout.input + joinLayout.button <= joinLayout.row);
    for (const theme of ['graphite', 'paper']) {
        await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
        const geometry = await page.locator('[role="dialog"]').evaluate(element => {
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            const probe = document.createElement('div');
            probe.style.color = 'var(--et-text-primary)';
            document.body.append(probe);
            const expectedColor = getComputedStyle(probe).color;
            probe.remove();
            return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
                color: style.color, expectedColor, background: style.backgroundImage,
                footerBottom: element.querySelector('.remote-control-footer').getBoundingClientRect().bottom,
                content: element.querySelector('.remote-control-content').getBoundingClientRect().height };
        });
        assert.ok(geometry.left >= 0 && geometry.right <= 480 && geometry.top >= 0 && geometry.bottom <= 600);
        assert.ok(geometry.footerBottom <= geometry.bottom && geometry.content > 0);
        assert.equal(geometry.color, geometry.expectedColor);
        assert.match(geometry.background, /gradient/);
    }
    await page.locator('#remote-control-close').focus();
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'remote-control-enabled');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'remote-control-close');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('[role="dialog"]').count(), 0);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'opener');
    assert.equal(await page.evaluate(() => statusListeners.size), 0);
    assert.equal(await page.evaluate(() => remoteStatus.enabled), true);
    assert.deepEqual(errors, []);
});

test('remote settings retain pairing, network selection, token renewal and joining', { timeout: 30000 }, async t => {
    const { page, errors } = await openDialog(t);
    assert.equal(await page.locator('#remote-control-pairing').isVisible(), false);
    await page.locator('#remote-control-enabled').check();
    await page.evaluate(() => pushStatus({
        clients: 1, addresses: [makeAddress('192.168.0.5'), makeAddress('192.168.0.6')],
        devices: [{ app: 'EffeTune', version: '2.13.0', address: '192.168.0.7' }]
    }));
    assert.match(await page.locator('#remote-control-status').textContent(), /1 devices connected/);
    assert.match(await page.locator('#remote-control-devices').textContent(), /192.168.0.7/);
    await page.locator('#remote-control-network').selectOption('1');
    assert.match(await page.locator('#remote-control-link').textContent(), /192.168.0.6/);
    await page.locator('#remote-control-copy').click();
    assert.equal(await page.locator('#remote-control-copy').textContent(), 'Copied');
    await page.locator('#remote-control-token').click();
    await page.waitForFunction(() => document.getElementById('remote-control-link').textContent.includes('new-code'));
    await page.locator('#remote-control-join-input').fill('http://192.168.0.8:47300/?t=abcd');
    await page.locator('#remote-control-join-input').press('Enter');
    await page.waitForFunction(() => document.getElementById('remote-control-join-input').value === '');
    assert.deepEqual(await page.evaluate(() => calls), [
        ['enabled', true], ['copy', 1], ['token'], ['join', 'http://192.168.0.8:47300/?t=abcd']
    ]);
    await page.locator('#remote-control-close').click();
    assert.equal(await page.evaluate(() => statusListeners.size), 0);
    assert.deepEqual(errors, []);
});

test('remote settings show useful failure messages and ignore an old request after reopening', { timeout: 30000 }, async t => {
    const { page, errors } = await openDialog(t);
    await page.evaluate(() => { window.copyFails = true; window.joinFails = true; });
    await page.locator('#remote-control-enabled').check();
    await page.locator('#remote-control-copy').click();
    assert.match(await page.locator('#remote-control-error').textContent(), /copy it manually/);
    await page.locator('#remote-control-join').click();
    assert.match(await page.locator('#remote-control-error').textContent(), /full pairing link/);
    await page.evaluate(() => pushStatus({ error: 'EADDRINUSE stack trace internal-details' }));
    assert.match(await page.locator('#remote-control-status').textContent(), /Turn it off and try again/);
    assert.ok(!(await page.locator('[role="dialog"]').textContent()).includes('internal-details'));
    await page.evaluate(() => {
        dialog.api.getStatus = () => new Promise(resolve => { window.finishOldRequest = resolve; });
        dialog.close();
        dialog.show();
    });
    await page.evaluate(() => {
        dialog.close();
        dialog.api.getStatus = async () => ({ ...remoteStatus, error: null, enabled: false, running: false });
        dialog.show();
        finishOldRequest({ ...remoteStatus, error: null, enabled: true, running: true });
    });
    await page.waitForFunction(() => !document.getElementById('remote-control-enabled').disabled);
    assert.equal(await page.locator('#remote-control-enabled').isChecked(), false);
    await page.locator('.remote-control-overlay').click({ position: { x: 1, y: 1 } });
    assert.equal(await page.locator('[role="dialog"]').count(), 0);
    assert.equal(await page.evaluate(() => statusListeners.size), 0);
    assert.deepEqual(errors, []);
});

test('Network settings shares the Remote Control permission, subscription and failed-save state with the original dialog', { timeout: 30000 }, async t => {
    const { page, errors } = await openDialog(t);
    await page.evaluate(async () => {
        window.electronAPI = {
            loadConfig: async () => ({ success: true, config: {} }),
            remoteV1: { settings: remoteSettingsApi },
            openHomeV1: { getStatus: async () => ({ enabled: false, friendlyName: 'Test PC' }) },
            networkMusicGetState: async () => ({ sharing: { enabled: false, folderIds: [], folders: [] } })
        };
        const { showConfigDialog } = await import('./js/electron/configIntegration.js');
        window.openNetworkConfig = () => showConfigDialog(true, {});
        await openNetworkConfig();
    });
    await page.locator('#config-category-network').click();
    const permission = page.locator('#network-remote-control-enabled');
    assert.equal(await permission.isChecked(), false);
    assert.equal(await permission.isDisabled(), false);
    assert.equal(await page.evaluate(() => statusListeners.size), 1, 'both controls must share the same host subscription');
    const layout = await page.evaluate(() => {
        const ids = ['network-device-name-section', 'network-remote-control-section', 'openhome-section', 'library-sharing-section'];
        const rows = ids.map(id => document.getElementById(id).getBoundingClientRect());
        return rows.map(row => ({ x: row.x, top: row.top, bottom: row.bottom, right: row.right }));
    });
    assert.ok(layout.every((row, index) => row.x === layout[0].x && row.right <= 1200 &&
        (index === 0 || row.top >= layout[index - 1].bottom)), 'Network groups must align below the common device name');
    await permission.check();
    await page.waitForFunction(() => !document.getElementById('network-remote-control-enabled').disabled);
    assert.equal(await page.locator('#remote-control-enabled').isChecked(), true);
    await page.evaluate(() => { window.permissionFails = true; });
    await permission.click();
    await page.waitForFunction(() => !document.getElementById('network-remote-control-enabled').disabled);
    assert.equal(await permission.isChecked(), true);
    assert.equal(await page.locator('#remote-control-enabled').isChecked(), true);
    assert.match(await page.locator('#network-remote-control-status').textContent(), /could not be updated/);
    assert.match(await page.locator('#remote-control-error').textContent(), /could not be updated/);
    await page.locator('#close-btn').click();
    assert.equal(await page.evaluate(() => statusListeners.size), 1);
    await page.evaluate(() => { window.permissionFails = false; });
    await page.locator('#remote-control-enabled').uncheck();
    await page.waitForFunction(() => !document.getElementById('remote-control-enabled').disabled);
    await page.evaluate(() => openNetworkConfig());
    assert.equal(await page.locator('#network-remote-control-enabled').isChecked(), false);
    await page.evaluate(() => pushStatus({ enabled: true, running: false, error: 'internal listener failure' }));
    assert.equal(await page.locator('#network-remote-control-enabled').isChecked(), true, 'the permission follows desired enabled, not running');
    assert.match(await page.locator('#network-remote-control-status').textContent(), /could not start/);
    assert.ok(!(await page.locator('#config-panel-network').textContent()).includes('internal listener failure'));
    await page.locator('#close-btn').click();
    await page.locator('#remote-control-close').click();
    assert.equal(await page.evaluate(() => statusListeners.size), 0);
    assert.deepEqual(await page.evaluate(() => calls), [['enabled', true], ['enabled', false], ['enabled', false]]);
    assert.deepEqual(errors, []);
});

test('the remote mobile add button uses the bottom edge without reserving absent navigation and player rows', { timeout: 30000 }, async t => {
    const { page, errors } = await openPage(t, { width: 375, height: 812 });
    await page.evaluate(async () => {
        const { RemoteMobileShell } = await import('./js/remote/remote-ui-manager.js');
        document.body.classList.add('layout-mobile', 'remote-client');
        const list = document.createElement('div');
        list.id = 'pluginList';
        document.body.append(list);
        new RemoteMobileShell().applyMode('mobile');
    });
    const bottomGap = () => page.locator('.mobile-plugin-fab').evaluate(button => innerHeight - button.getBoundingClientRect().bottom);
    assert.equal(await bottomGap(), 16);
    await page.locator('.mobile-plugin-fab').click();
    assert.equal(await page.locator('#pluginList').evaluate(list => list.classList.contains('mobile-open')), true);
    await page.locator('.mobile-plugin-list-close').click();
    await page.evaluate(() => document.body.classList.remove('remote-client'));
    assert.equal(await bottomGap(), 124);
    assert.deepEqual(errors, []);
});

async function openEffectPage(t) {
    const { page, errors } = await openPage(t);
    await page.evaluate(async () => {
        await import('./js/ui/range-fill.js');
        const { RemoteAudioManager } = await import('./js/remote/remote-audio-manager.js');
        const { createRemoteUiManager, loadTranslations } = await import('./js/remote/remote-ui-manager.js');
        const { TelemetryHub } = await import('./js/audio/telemetry-hub.js');
        const { publishDspParamPackers } = await import('./js/audio/dsp-wasm-loader.js');
        const params = await import('./js/audio/dsp-params.generated.js');
        publishDspParamPackers(params);
        window.__EFFECTUNE_WASM_ONLY__ = true;
        window.uiManager = createRemoteUiManager(await loadTranslations({ language: 'en' }));
        window.audioManager = new RemoteAudioManager();
        window.audioContext = audioManager.audioContext;
        window.workletNode = audioManager.workletNode;
        window.dspTelemetryHub = new TelemetryHub({ port: workletNode.port });
        uiManager.audioManager = audioManager;
        window.irLibraryService = {
            list: () => [], get: () => null, refresh: async () => [], readAnalysis: async () => null,
            subscribe: () => () => {}, addEventListener() {}, removeEventListener() {}
        };
        document.body.classList.add('remote-client');
        const effects = document.createElement('main');
        effects.id = 'effect-fixture';
        effects.style.cssText = 'flex: 1; min-height: 0; overflow: auto;';
        document.body.append(effects);
        window.plugins = {};
        const { PluginManager } = await import('./js/plugin-manager.js');
        window.pluginManager = new PluginManager();
        await pluginManager.loadPlugins();
    });
    return { page, errors };
}

test('remote Dynamic EQ sidechain frequency edits refresh every band without rebuilding the UI', { timeout: 30000 }, async t => {
    const { page } = await openEffectPage(t);
    const result = await page.evaluate(async () => {
        const { applyParamsToPlugin } = await import('./js/remote/pipeline-apply.js');
        const plugin = pluginManager.createPlugin('5Band Dynamic EQ');
        audioManager.pipeline.push(plugin);
        const ui = plugin.createUI();
        document.getElementById('effect-fixture').append(ui);
        const bands = plugin.getSerializableParameters().bs.map((band, index) => ({ ...band, scf: 321 + index * 123 }));
        applyParamsToPlugin(plugin, { bs: bands });
        plugin.syncUIControls();
        const values = bands.map((band, index) => ({
            expected: band.scf,
            actual: Number(ui.querySelector(`[id="${plugin.instanceId}-band${index}-SCFreq.Hz-input"]`).value),
            slider: Number(ui.querySelector(`[id="${plugin.instanceId}-band${index}-SCFreq.Hz-slider"]`).value),
            expectedSlider: Math.round(plugin._logFreqToSlider(band.scf) * 100) / 100
        }));
        plugin.cleanup();
        return values;
    });
    for (const value of result) {
        assert.equal(value.actual, value.expected);
        assert.equal(value.slider, value.expectedSlider);
    }
});

test('remote effect UIs hide local audio outputs and retain parameter curves and editing', { timeout: 60000 }, async t => {
    const { page, errors } = await openEffectPage(t);
    const pureViews = [
        'AnalogMeterPlugin', 'ChromaSpiralPlugin', 'LevelMeterPlugin', 'NoteSpectrogramPlugin',
        'OscilloscopePlugin', 'PitchMeterPlugin', 'RhythmAnalyzerPlugin', 'SpectrogramPlugin',
        'SpectrumAnalyzerPlugin', 'StereoMeterPlugin', 'AutoLevelerPlugin', 'TransientShaperPlugin',
        'MultibandTransientPlugin', 'PowerAmpSagPlugin', 'AMRadioSimulatorPlugin', 'FMRadioSimulatorPlugin',
        'SWRadioSimulatorPlugin', 'TVAudioSimulatorPlugin', 'VinylSimulatorPlugin', 'ClickRemoverPlugin'
    ];
    const mixedViews = [
        'CompressorPlugin', 'FiveBandDynamicEQ', 'FiveBandFIRPEQPlugin', 'TonalBalanceEQPlugin',
        'DSD64IMDSimulatorPlugin', 'CassetteArtifactsPlugin', 'TapeArtifactsPlugin', 'IRReverbPlugin', 'TubeSimulatorPlugin',
        'RoomEqPlugin', 'CrosstalkCancellationPlugin', 'SFZNotePlayerPlugin', 'AdaptivePredictionEffectPlugin', 'PhaseSelectEqPlugin'
    ];
    await page.evaluate(async names => {
        for (const name of names) {
            const plugin = new window[name]();
            plugin.hasLocalAudio = audioManager.hasLocalAudio;
            plugin.id = Object.keys(plugins).length + 1;
            plugin.setWasmAssetTargetResolver(() => []);
            plugins[name] = plugin;
            if (['RoomEqPlugin', 'CrosstalkCancellationPlugin'].includes(name)) {
                plugin._getMeasurementStore = () => { throw new Error('Remote plugins must not read local measurements'); };
            }
            if (name === 'SFZNotePlayerPlugin') {
                plugin._getLibraryService = () => { throw new Error('Remote plugins must not read local SFZ banks'); };
            }
            if (name === 'IRReverbPlugin') {
                plugin._resolveSerializedIr = () => { throw new Error('Remote plugins must not decode local IRs'); };
            }
            audioManager.pipeline.push(plugin);
            const section = document.createElement('section');
            section.id = name;
            section.append(plugin.createUI());
            document.getElementById('effect-fixture').append(section);
        }
    }, [...pureViews, ...mixedViews]);
    for (const name of pureViews) {
        assert.ok(await page.locator(`#${name} .local-audio-only`).count() > 0, name);
        assert.equal(await page.locator(`#${name} canvas:visible`).count(), 0, name);
    }
    assert.equal(await page.locator('.local-audio-only:visible, .plugin-execution-status:visible').count(), 0);
    assert.equal(await page.locator('#CompressorPlugin canvas').isVisible(), true);
    assert.equal(await page.locator('#FiveBandFIRPEQPlugin .five-band-fir-peq-graph').isVisible(), true);
    assert.equal(await page.locator('#DSD64IMDSimulatorPlugin .dsd64-imd-tc-wrap').isVisible(), true);
    assert.equal(await page.locator('#DSD64IMDSimulatorPlugin .dsd64-imd-df-wrap').isVisible(), true);
    assert.equal(await page.locator('#TonalBalanceEQPlugin canvas').isVisible(), true);
    assert.equal(await page.locator('#TubeSimulatorPlugin .tube-simulator-hud').isVisible(), true);
    assert.equal(await page.locator('#IRReverbPlugin input[type="range"]').first().isVisible(), true);
    assert.equal(await page.locator('#IRReverbPlugin .ir-reverb-import-actions button:visible').count(), 1);
    assert.equal(await page.locator('#SFZNotePlayerPlugin .sfz-bank-row').isVisible(), false);
    assert.equal(await page.locator('#CrosstalkCancellationPlugin .crosstalk-cancellation-measurements').isVisible(), false);
    assert.equal(await page.locator('#RoomEqPlugin .room-eq-measurement-row').isVisible(), false);
    assert.equal(await page.locator('#RoomEqPlugin .room-eq-response-view-controls').isVisible(), false);
    assert.equal(await page.locator('#RoomEqPlugin .room-eq-additional-eq-ui').isVisible(), true);
    assert.equal(await page.locator('#PhaseSelectEqPlugin canvas').isVisible(), true);
    assert.equal(await page.locator('#AdaptivePredictionEffectPlugin .analog-meter-reset-button').isVisible(), false);
    assert.equal(await page.locator('#AnalogMeterPlugin .analog-meter-reset-button').isVisible(), false);
    assert.equal(await page.locator('#RhythmAnalyzerPlugin .analog-meter-reset-button').isVisible(), false);
    const hostAssets = await page.evaluate(async () => {
        plugins.IRReverbPlugin.setSerializedParameters({ ir: 'a'.repeat(24), cm: 'mono' });
        plugins.SFZNotePlayerPlugin.setParameters({ sf: 'b'.repeat(24) });
        plugins.RoomEqPlugin.setParameters({ ms: 'host-measurement', rp: 4 });
        audioManager.applyHostAudioState({ sampleRate: 96000, channelCount: 8, routingChannelCount: 16 });
        plugins.CrosstalkCancellationPlugin.setParameters({ ll: 'host-left', lr: 'host-right' });
        plugins.CassetteArtifactsPlugin.setParameters({ nr: 'Dolby C' });
        await new Promise(resolve => setTimeout(resolve, 200));
        return {
            ir: plugins.IRReverbPlugin.ir, sf: plugins.SFZNotePlayerPlugin.sf,
            ms: plugins.RoomEqPlugin.measurementId, rp: plugins.RoomEqPlugin.rp,
            roomRate: plugins.RoomEqPlugin._sampleRate
        };
    });
    assert.deepEqual(hostAssets, { ir: 'a'.repeat(24), sf: 'b'.repeat(24), ms: 'host-measurement', rp: 4, roomRate: 96000 });
    assert.equal(await page.locator('#TubeSimulatorPlugin .tube-simulator-value:not(.local-audio-only)').count(), 2);
    assert.ok(!(await page.locator('#CassetteArtifactsPlugin .cassette-artifacts-status').textContent()).includes('measuring'));
    assert.match(await page.locator('#TapeArtifactsPlugin .tape-artifacts-status').textContent(), /Record Level/);
    const remoteRows = await page.evaluate(() => {
        const plugin = plugins.FiveBandDynamicEQ;
        return plugin._readGraph(plugin._readoutFrame.width / 2).rows.map(row => row.label);
    });
    assert.deepEqual(remoteRows, ['Sidechain', 'Static']);
    await page.locator('#CompressorPlugin input[type="number"]').first().fill('-24');
    await page.locator('#CompressorPlugin input[type="number"]').first().dispatchEvent('input');
    assert.equal(await page.evaluate(() => plugins.CompressorPlugin.th), -24);
    const normalRows = await page.evaluate(() => {
        document.body.classList.remove('remote-client');
        delete audioManager.hasLocalAudio;
        for (const plugin of Object.values(plugins)) delete plugin.hasLocalAudio;
        const plugin = plugins.FiveBandDynamicEQ;
        return plugin._readGraph(plugin._readoutFrame.width / 2).rows.map(row => row.label);
    });
    assert.deepEqual(normalRows, ['Sidechain', 'Static', 'Dynamic']);
    assert.equal(await page.locator('#SpectrumAnalyzerPlugin canvas').isVisible(), true);
    assert.deepEqual(errors, []);
});

for (const irSync of [false, true]) {
test(`IR Reverb host picker respects ${irSync ? 'IR transfer' : 'selection-only'} capabilities`, { timeout: 30000 }, async t => {
    const { page, errors } = await openEffectPage(t);
    await page.evaluate(async irSync => {
        const { createRemoteIrLibrary } = await import('./js/remote/remote-ir-library.js');
        window.selectedIr = null;
        window.irLibraryService = createRemoteIrLibrary({
            features: new Set(irSync ? ['irSelection', 'irSync'] : ['irSelection']),
            request: async () => ({ items: [{ id: 'c'.repeat(24), name: 'Host Hall.wav',
                channels: irSync ? 2 : 4, topology: irSync ? 'stereo' : 'true-stereo' }] })
        }, async (plugin, entry) => {
            selectedIr = { pluginId: plugin.id, ir: entry.irId };
            return true;
        });
        const plugin = new IRReverbPlugin();
        plugin.hasLocalAudio = audioManager.hasLocalAudio;
        plugin.id = 1;
        plugin.setWasmAssetTargetResolver(() => []);
        audioManager.pipeline.push(plugin);
        document.getElementById('effect-fixture').append(plugin.createUI());
    }, irSync);
    await page.locator('.ir-reverb-import-actions button:visible').click();
    await page.locator('.ir-library-entry').waitFor();
    assert.match(await page.locator('.ir-library-entry').textContent(), /Host Hall.wav/);
    const dialog = page.locator('.ir-library-dialog');
    assert.equal(await dialog.getByRole('button', { name: /^Delete(?: selected)?$/, includeHidden: true }).count(), 0);
    assert.equal(await dialog.locator('.ir-library-decay').count(), 0);
    assert.equal(await dialog.getByRole('button', { name: 'Upload file…', exact: true }).count(), irSync ? 1 : 0);
    assert.equal(await dialog.getByRole('button', { name: 'Cancel import', exact: true, includeHidden: true }).count(), irSync ? 1 : 0);
    assert.equal(await dialog.getByRole('button', { name: 'Download', exact: true }).count(), irSync ? 1 : 0);
    const fileInput = dialog.locator('input[type="file"]');
    assert.equal(await fileInput.count(), irSync ? 1 : 0);
    if (irSync) {
        assert.equal(await fileInput.evaluate(input => input.multiple), false);
        assert.equal(await dialog.getByRole('button', { name: 'Upload file…', exact: true }).isEnabled(), true);
        assert.equal(await dialog.getByRole('button', { name: 'Download', exact: true }).isEnabled(), true);
    }
    await dialog.locator('.ir-library-actions .ir-library-primary-action').click();
    assert.deepEqual(await page.evaluate(() => selectedIr), { pluginId: 1, ir: 'c'.repeat(24) });
    assert.deepEqual(errors, []);
});
}

test('remote sliders send one operation per drag and flush pending values before undo', { timeout: 60000 }, async t => {
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    const remoteOrigin = 'http://192.168.0.5:47300';
    const errors = [];
    const requests = [];
    let model = { masterBypass: false, slot: 'A', ids: ['h.1'], pipeline: [{ nm: 'Volume', en: true, vl: 0 }] };
    let rev = 1;
    page.on('pageerror', error => errors.push(error.message));
    await page.route(`${remoteOrigin}/**`, async route => {
        const pathname = new URL(route.request().url()).pathname;
        const file = path.resolve(root, pathname === '/' ? 'remote.html' : `.${pathname}`);
        const relative = path.relative(root, file);
        if (relative.startsWith('..') || path.isAbsolute(relative)) return route.fulfill({ status: 403, body: '' });
        const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
            '.css': 'text/css', '.json5': 'application/json', '.json': 'application/json', '.wasm': 'application/wasm' };
        await route.fulfill({ contentType: types[path.extname(file)], body: await fs.readFile(file) });
    });
    await page.routeWebSocket(`ws://192.168.0.5:47300/**`, socket => {
        socket.onMessage(raw => {
            const message = JSON.parse(raw.toString());
            requests.push(message);
            if (message.op === 'edit') {
                const next = applyOps(model, message.ops).snapshot;
                if (!deepEqual(next, model)) rev += 1;
                model = next;
            }
            socket.send(JSON.stringify({ op: 'ack', seq: message.seq, ok: true, rev }));
            if (['hello', 'get', 'edit', 'history'].includes(message.op)) {
                socket.send(JSON.stringify({ op: 'state', epoch: 'e1', rev, features: ['sync1'], ...model }));
            }
        });
    });
    await page.goto(`${remoteOrigin}/?t=test-pairing-token`);
    await page.waitForFunction(() => window.remoteClient?.engine.confirmed);
    assert.equal(await page.evaluate(() => window.isSecureContext), false);
    const slider = page.locator('#pipelineList input[type="range"]').first();
    await slider.waitFor({ state: 'visible' });
    await page.locator('#pipelineList input[type="number"]').first().fill('-6');
    await page.waitForFunction(() => remoteClient.engine.isIdle());
    const numberOperation = await page.evaluate(() => remoteClient.engine.operation.id);
    const bounds = await slider.boundingBox();
    const y = bounds.y + bounds.height / 2;
    await page.mouse.move(bounds.x + bounds.width * 0.7, y);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width * 0.8, y);
    await page.waitForFunction(() => remoteClient.engine.operation?.sent);
    await new Promise(resolve => setTimeout(resolve, 1100));
    await page.mouse.move(bounds.x + bounds.width * 0.9, y);
    await page.mouse.up();
    await page.waitForFunction(() => !remoteClient.engine.operation && remoteClient.engine.isIdle());
    const firstDrag = requests.filter(request => request.op === 'edit' && request.operation !== numberOperation);
    assert.ok(firstDrag.filter(request => request.ops.length > 0).length >= 2);
    assert.ok(firstDrag.every(request => request.operation === firstDrag[0].operation));
    assert.equal(firstDrag.at(-1).operationEnd, true);

    const beforeSecond = requests.length;
    const secondBounds = await slider.boundingBox();
    const secondY = secondBounds.y + secondBounds.height / 2;
    await page.mouse.move(secondBounds.x + secondBounds.width * 0.8, secondY);
    await page.mouse.down();
    await page.mouse.move(secondBounds.x + secondBounds.width * 0.75, secondY);
    await page.mouse.up();
    await page.waitForFunction(() => !remoteClient.engine.operation && remoteClient.engine.isIdle());
    const secondDrag = requests.slice(beforeSecond).filter(request => request.op === 'edit');
    assert.ok(secondDrag.length >= 2);
    assert.ok(secondDrag.every(request => request.operation === secondDrag[0].operation));
    assert.notEqual(secondDrag[0].operation, firstDrag[0].operation);

    const beforeUndo = requests.length;
    await slider.evaluate(element => {
        element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
        element.value = Number(element.value) - 1;
        element.dispatchEvent(new Event('input', { bubbles: true }));
        window.remoteClient.pipelineManager.undo();
        element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }));
    });
    await page.waitForFunction(() => document.getElementById('remoteMessage').textContent === 'Undid last change');
    const undoRequests = requests.slice(beforeUndo);
    assert.deepEqual(undoRequests.map(request => request.op), ['edit', 'edit', 'history']);
    assert.equal(undoRequests[0].ops.length, 1);
    assert.equal(undoRequests[1].operationEnd, true);
    assert.equal(undoRequests[2].dir, 'undo');
    assert.deepEqual(errors, []);
});
