import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { chromium, _electron as electron } from 'playwright';

const root = fileURLToPath(new URL('../../', import.meta.url));
const origin = 'https://effetune.test';

async function initializeLocalEditor(native) {
    const main = document.querySelector('.main-container');
    document.body.replaceChildren(main);
    const player = document.createElement('div');
    player.className = 'fixture-player';
    player.style.height = '400px';
    main.before(player);
    const style = document.createElement('style');
    style.textContent = 'body.layout-mobile .fixture-player { display: none; }';
    document.head.append(style);
    document.documentElement.classList.remove('app-starting');
    if (native) window.electronIntegration = { isElectron: true };
    window.__EFFECTUNE_WASM_ONLY__ = true;
    const { PluginManager } = await import('./js/plugin-manager.js');
    const { PipelineManager } = await import('./js/ui/pipeline-manager.js');
    const { PluginListManager } = await import('./js/ui/plugin-list-manager.js');
    const { RemoteAudioManager } = await import('./js/remote/remote-audio-manager.js');
    const { createRemoteUiManager, loadTranslations } = await import('./js/remote/remote-ui-manager.js');
    window.uiManager = createRemoteUiManager(await loadTranslations({ language: 'en' }));
    window.audioManager = new RemoteAudioManager();
    window.pluginManager = new PluginManager();
    await pluginManager.loadPlugins();
    const list = new PluginListManager(pluginManager);
    uiManager.pluginListManager = list;
    window.pipelineManager = new PipelineManager(audioManager, pluginManager, uiManager.expandedPlugins, list, { enableFileProcessing: false });
    uiManager.pipelineManager = audioManager.pipelineManager = pipelineManager;
    list.initPluginList();
    list.collapseManager.markReady();
    audioManager.pipeline = Array.from({ length: 4 }, () => pluginManager.createPlugin('Volume'));
    for (const plugin of audioManager.pipeline) uiManager.expandedPlugins.add(plugin.id);
    pipelineManager.core.updatePipelineUI();
    uiManager.layoutMode.onChange(() => {
        const columns = pipelineManager.core.columnManager;
        columns.updatePipelineColumns(columns.getCurrentColumns());
        list.updatePositions();
    });
    const { IntegratedRemoteEffects } = await import('./js/remote/integrated-remote-effects.js');
    const container = document.createElement('section');
    container.className = 'network-effects';
    main.after(container);
    window.connections = 0;
    window.disconnections = 0;
    window.manageCalls = [];
    let listener;
    const api = {
        getConnection: async () => ({ registered: true }),
        requestConnection: async () => ({ ok: true }),
        cancelConnectionRequest: async () => {},
        onEvent: callback => { listener = callback; return () => { listener = null; }; },
        connect: async () => {
            const connectionId = `fixture-${++connections}`;
            listener({ type: 'open', connectionId });
            return { ok: true, connectionId };
        },
        disconnect: async () => { disconnections += 1; },
        send: async (connectionId, raw) => {
            const message = JSON.parse(raw);
            listener({ type: 'message', connectionId, data: JSON.stringify({ op: 'ack', seq: message.seq, ok: true }) });
            if (message.op === 'hello' || message.op === 'get') listener({ type: 'message', connectionId, data: JSON.stringify({
                op: 'state', epoch: 'fixture', rev: 1, features: ['sync1'], host: 'Server label',
                masterBypass: false, slot: 'A', ids: ['h.1', 'h.2', 'h.3', 'h.4'],
                pipeline: Array.from({ length: 4 }, () => ({ nm: 'Volume', en: true, vl: 0 }))
            }) });
            return true;
        },
        ...(!native ? { manageConnection: id => manageCalls.push(id) } : {})
    };
    window.effects = new IntegratedRemoteEffects({ container, api });
    window.expireEffectsConnection = () => listener({ type: 'close', connectionId: effects.connectionId, code: 4401 });
}

function geometry() {
    const pipeline = document.getElementById('pipeline');
    const main = document.querySelector('.main-container');
    const rect = element => {
        const bounds = element.getBoundingClientRect();
        return { x: bounds.x, width: bounds.width, right: bounds.right };
    };
    return {
        viewport: document.documentElement.clientWidth,
        bodyPadding: parseFloat(getComputedStyle(document.body).paddingLeft),
        available: pipelineManager.core.columnManager.getAvailablePipelineWidth(),
        columns: document.querySelectorAll('.pipeline-column').length,
        mode: uiManager.layoutMode.mode,
        body: rect(document.body), main: rect(main), pipeline: rect(pipeline),
        items: [...document.querySelectorAll('.pipeline-item')].map(rect),
        overflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth)
    };
}

for (const native of [true, false]) {
    const kind = native ? 'native' : 'PWA';
    test(`${kind} integrated remote.html keeps the local pipeline width, responsive columns and connection row`, { timeout: 90000 }, async () => {
        const scratch = await realpath(await mkdtemp(path.join(os.tmpdir(), 'effetune-integrated-layout-')));
        let application;
        let browser;
        let page;
        const errors = [];
        try {
            const html = (await readFile(path.join(root, 'effetune.html'), 'utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
            if (native) {
                const fixture = path.join(scratch, 'fixture.html');
                await writeFile(fixture, html.replace('<head>', `<head><base href="${pathToFileURL(root).href}">`));
                const main = path.join(scratch, 'main.cjs');
                await writeFile(main, `const { app, BrowserWindow } = require('electron');
                    app.setPath('userData', ${JSON.stringify(path.join(scratch, 'profile'))});
                    app.whenReady().then(() => {
                        const win = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { contextIsolation: true, nodeIntegration: false } });
                        win.loadFile(${JSON.stringify(fixture)});
                    });
                    app.on('window-all-closed', () => app.quit());`);
                application = await electron.launch({ args: [main], timeout: 20000 });
                page = await application.firstWindow();
                await page.waitForLoadState();
            } else {
                browser = await chromium.launch();
                page = await browser.newPage();
                await page.route(`${origin}/**`, async route => {
                    const pathname = new URL(route.request().url()).pathname;
                    if (pathname === '/') return route.fulfill({ contentType: 'text/html', body: html });
                    const file = path.resolve(root, `.${pathname}`);
                    const relative = path.relative(root, file);
                    if (relative.startsWith('..') || path.isAbsolute(relative)) return route.fulfill({ status: 403, body: '' });
                    const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
                        '.css': 'text/css', '.json5': 'application/json', '.json': 'application/json', '.wasm': 'application/wasm' };
                    await route.fulfill({ contentType: types[path.extname(file)], body: await readFile(file) });
                });
                await page.goto(origin);
            }
            page.on('pageerror', error => errors.push(error.message));
            page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
            const resize = async width => {
                if (application) await application.evaluate(({ BrowserWindow }, width) => {
                    BrowserWindow.getAllWindows()[0].setContentSize(width, 900);
                }, width);
                else await page.setViewportSize({ width, height: 900 });
                await page.waitForFunction(width => window.innerWidth === width, width);
            };
            const measurements = [];
            for (const width of [2537, 2538, 2560, 1180, 1100, ...(native ? [] : [390])]) {
                await resize(width);
                await page.reload();
                await page.evaluate(initializeLocalEditor, native);
                await page.waitForTimeout(300);
                await page.waitForFunction(() => document.querySelector('.main-container').getAnimations({ subtree: true }).every(animation => animation.playState !== 'running'));
                const local = await page.evaluate(geometry);
                measurements.push({ width, local });
                if (process.env.EFFETUNE_LAYOUT_SCREENSHOTS && [2538, 1100].includes(width)) {
                    await page.screenshot({ path: path.join(process.env.EFFETUNE_LAYOUT_SCREENSHOTS, `${kind}-local-${width}.png`) });
                }
            }
            for (const measurement of measurements) {
                const { width, local } = measurement;
                await resize(width);
                if (width === 390) {
                    await page.evaluate(async () => {
                        document.body.classList.remove('network-player-selected');
                        const { MobileNav } = await import('./js/ui/mobile-nav.js');
                        uiManager.mobileNav = new MobileNav(uiManager);
                        uiManager.mobileNav.setView('effects');
                    });
                    assert.equal(await page.locator('body > .mobile-plugin-fab').isVisible(), true);
                }
                await page.evaluate(async () => {
                    document.body.classList.add('network-player-selected');
                    if (!effects.frame) await effects.selectPlayer({ id: 'bedroom', name: 'Bedroom PC' });
                });
                const frame = page.frames().find(candidate => candidate.parentFrame());
                await frame.waitForFunction(() => window.remoteClient?.session.status === 'open' && window.remoteClient.engine.confirmed, null, { timeout: 10000 });
                await page.waitForTimeout(300);
                await frame.waitForFunction(() => document.querySelector('.main-container').getAnimations({ subtree: true }).every(animation => animation.playState !== 'running'));
                await frame.waitForFunction(() => uiManager.layoutMode.isMobile ||
                    (document.documentElement.clientWidth === Math.ceil(document.querySelector('.main-container').getBoundingClientRect().width) &&
                    document.documentElement.scrollWidth === document.documentElement.clientWidth));
                const remote = await frame.evaluate(geometry);
                measurement.remote = remote;
                assert.ok(Math.abs(remote.available - local.available) < 0.01, `${kind} ${width}px: pipeline width budget ${remote.available} / ${local.available}`);
                assert.equal(remote.columns, local.columns, `${kind} ${width}px: actual rendered columns ${JSON.stringify({ local, remote })}`);
                assert.equal(remote.mode, local.mode, `${kind} ${width}px: layout mode`);
                assert.equal(remote.pipeline.width, local.pipeline.width, `${kind} ${width}px: rendered pipeline width`);
                assert.deepEqual(remote.items.map(item => item.width), local.items.map(item => item.width));
                const outer = await page.evaluate(() => {
                    const frame = document.querySelector('iframe').getBoundingClientRect();
                    const body = document.body.getBoundingClientRect();
                    return { frameX: frame.x, frameWidth: frame.width, bodyWidth: body.width,
                        overflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth) };
                });
                if (local.mode === 'desktop') {
                    assert.equal(outer.frameWidth, local.main.width, `${kind} ${width}px: no extra space beside the editor`);
                    assert.equal(outer.bodyWidth, local.body.width, `${kind} ${width}px: outer page width matches local`);
                    assert.equal(outer.frameX + remote.pipeline.right, local.pipeline.right, `${kind} ${width}px: pipeline right edge matches local`);
                    assert.equal(remote.overflow, 0, `${kind} ${width}px: no inner horizontal scrollbar`);
                }
                assert.equal(outer.overflow, local.overflow, `${kind} ${width}px: outer horizontal overflow`);
                assert.equal(remote.columns, Math.max(1, Math.floor((local.available + 10) / 1074)));
                const connectionRow = await frame.locator('.remote-bar').evaluate(element => {
                    const row = element.getBoundingClientRect();
                    const button = element.querySelector('button').getBoundingClientRect();
                    return { visible: button.width > 0, fits: button.right <= Math.min(row.right, document.documentElement.clientWidth),
                        text: element.innerText, rowWidth: row.width };
                });
                assert.ok(connectionRow.visible && connectionRow.fits, `${kind} ${width}px: connection action fits the row`);
                assert.match(connectionRow.text, /Connected[\s\S]*Bedroom PC[\s\S]*Change connection/);
                assert.equal(await page.locator('.network-effects > .pipeline-header').count(), 0);
                if (width === 390) {
                    assert.equal(await page.locator('body > .mobile-plugin-fab').isVisible(), false);
                    assert.ok(remote.items.every(item => item.width === remote.viewport));
                    const rightEdges = await frame.evaluate(() => ({
                        toolbar: document.getElementById('redoButton').getBoundingClientRect().right,
                        effects: [...document.querySelectorAll('.pipeline-item-header > .delete-button')].map(button => button.getBoundingClientRect().right)
                    }));
                    assert.equal(rightEdges.toolbar, remote.viewport - 8);
                    assert.ok(rightEdges.effects.length > 0 && rightEdges.effects.every(right => right === rightEdges.toolbar));
                    const rowMargins = await frame.locator('.remote-bar').evaluate(element => {
                        const rect = element.getBoundingClientRect();
                        return [rect.left, document.documentElement.clientWidth - rect.right,
                            element.firstElementChild.getBoundingClientRect().left,
                            document.documentElement.clientWidth - element.querySelector('button').getBoundingClientRect().right];
                    });
                    assert.deepEqual(rowMargins, [0, 0, 8, 8]);
                    await frame.evaluate(() => document.querySelector('.pipeline-item').style.minHeight = '2200px');
                    await page.waitForFunction(() => document.querySelector('iframe').clientHeight > 2200);
                    assert.equal(await frame.evaluate(() => document.documentElement.scrollHeight > document.documentElement.clientHeight), false);
                    await page.mouse.move(180, 300);
                    await page.mouse.wheel(0, 500);
                    await page.waitForFunction(() => window.scrollY > 0);
                    assert.equal(await frame.evaluate(() => window.scrollY), 0);
                    await frame.waitForFunction(() => {
                        const frameTop = window.frameElement.getBoundingClientRect().top;
                        const button = document.querySelector('.mobile-plugin-fab').getBoundingClientRect();
                        return frameTop + button.top > 0 && frameTop + button.bottom < parent.innerHeight;
                    });
                    const addEffect = frame.locator('.mobile-plugin-fab');
                    assert.equal(await addEffect.count(), 1);
                    assert.equal(await addEffect.isVisible(), true);
                    await addEffect.click();
                    assert.equal(await frame.locator('#pluginList').evaluate(element => element.classList.contains('mobile-open')), true);
                    await frame.locator('.mobile-plugin-list-close').click();
                    await frame.evaluate(() => document.querySelector('.pipeline-item').style.removeProperty('min-height'));
                    await page.evaluate(() => window.scrollTo(0, 0));
                    await page.evaluate(() => document.body.classList.remove('network-player-selected'));
                    assert.equal(await page.locator('body > .mobile-plugin-fab').isVisible(), true);
                    await page.evaluate(() => document.body.classList.add('network-player-selected'));
                }
                if (process.env.EFFETUNE_LAYOUT_SCREENSHOTS && [2538, 1100, 390].includes(width)) {
                    await page.screenshot({ path: path.join(process.env.EFFETUNE_LAYOUT_SCREENSHOTS, `${kind}-remote-${width}.png`) });
                }
            }
            const frame = page.frames().find(candidate => candidate.parentFrame());
            await resize(2560);
            await page.waitForTimeout(300);
            await frame.waitForFunction(() => document.querySelector('.main-container').getAnimations({ subtree: true }).every(animation => animation.playState !== 'running'));
            const shortHeight = await page.locator('iframe').evaluate(element => element.clientHeight);
            await frame.evaluate(() => {
                document.querySelector('.pipeline-item').style.minHeight = '2200px';
            });
            await page.waitForFunction(() => document.querySelector('iframe').clientHeight > 2200);
            assert.equal(await frame.evaluate(() => document.documentElement.scrollHeight > document.documentElement.clientHeight), false,
                `${kind}: tall effects must not create an inner vertical scrollbar`);
            assert.equal(await page.evaluate(() => document.documentElement.scrollHeight > document.documentElement.clientHeight), true);
            const frameBox = await page.locator('iframe').boundingBox();
            await page.mouse.move(frameBox.x + 500, frameBox.y + 200);
            await page.mouse.wheel(0, 500);
            await page.waitForFunction(() => window.scrollY > 0);
            assert.equal(await frame.evaluate(() => window.scrollY), 0, `${kind}: wheel scroll belongs to the outer page`);
            await frame.evaluate(() => document.querySelector('.pipeline-item').style.removeProperty('min-height'));
            await page.waitForFunction(height => document.querySelector('iframe').clientHeight <= height, shortHeight);
            const identity = await page.evaluate(() => {
                window.savedFrame = effects.frame;
                window.savedPort = effects.port;
                const connectionId = effects.connectionId;
                effects.updatePlayerName('Studio PC');
                return connectionId;
            });
            await frame.waitForFunction(() => document.getElementById('remoteHost').textContent === 'Studio PC');
            assert.equal(await page.locator('iframe').getAttribute('title'), 'Effect Pipeline · Studio PC');
            assert.deepEqual(await page.evaluate(() => ({ sameFrame: effects.frame === savedFrame, samePort: effects.port === savedPort,
                connectionId: effects.connectionId, connections, disconnections })),
            { sameFrame: true, samePort: true, connectionId: identity, connections: 1, disconnections: 0 });
            await page.evaluate(() => expireEffectsConnection());
            await frame.waitForFunction(() => remoteClient.session.status === 'unauthorized');
            assert.equal(await frame.locator('.main-container').evaluate(element => element.inert), true);
            await frame.getByRole('button', { name: 'Change connection', exact: true }).click();
            if (native) {
                await page.waitForFunction(() => effects.frame === null);
                await page.getByRole('button', { name: 'Connect effects', exact: true }).click();
                const next = page.frames().find(candidate => candidate.parentFrame());
                await next.waitForFunction(() => window.remoteClient?.session.status === 'open');
                assert.equal(await page.evaluate(() => connections), 2);
                assert.equal(await page.evaluate(() => disconnections), 1);
            } else {
                await page.waitForFunction(() => manageCalls.length === 1);
                assert.deepEqual(await page.evaluate(() => manageCalls), ['bedroom']);
                assert.equal(await page.evaluate(() => effects.connectionId), identity);
            }
            assert.deepEqual(errors, []);
            process.stdout.write(`${kind} layout measurements: ${JSON.stringify(measurements)}\n`);
            await page.evaluate(() => effects.dispose());
        } catch (error) {
            if (page) process.stderr.write(JSON.stringify({ errors, frames: await Promise.all(page.frames().map(frame => frame.evaluate(() => ({
                url: location.href, origin: location.origin, body: document.body.className,
                notice: document.getElementById('remoteNotice')?.textContent,
                port: !!window.effects?.port, connection: window.effects?.connectionId,
                remote: window.remoteClient?.session.status
            })).catch(() => null))) }) + '\n');
            throw error;
        } finally {
            await application?.close();
            await browser?.close();
            await rm(scratch, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
        }
    });
}
