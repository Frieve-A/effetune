import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { registerIntegratedRemoteClientIpc } from '../../electron/remote-client-window.cjs';
import { parseCommentedJSON } from '../../js/utils/parse-commented-json.js';

test('Connect effects explains unavailable requests and keeps approval and connections during a name change', { timeout: 30000 }, async () => {
  const scratch = await realpath(await mkdtemp(path.join(os.tmpdir(), 'effetune-effects-ui-')));
  const handlers = new Map();
  const sender = new EventEmitter();
  const diagnostics = [];
  const calls = [];
  const pairingRequests = [];
  let origin = null;
  let pairing = null;
  let announcePairing;
  let pairingStarted = new Promise(resolve => { announcePairing = resolve; });
  const dispose = registerIntegratedRemoteClientIpc({
    ipcMain: { handle: (name, handler) => handlers.set(name, handler), removeHandler: name => handlers.delete(name) },
    getMainWindow: () => ({ webContents: sender }),
    app: { getPath: () => scratch },
    getPairingEndpoint: () => origin,
    getClientName: () => 'Fixture client',
    requestPairing: request => new Promise(resolve => {
      pairingRequests.push(request.playerId);
      pairing = { ...request, resolve };
      request.signal.addEventListener('abort', () => resolve({ status: 'cancelled' }), { once: true });
      announcePairing();
    }),
    log: (...args) => diagnostics.push(args)
  });
  let browser;
  try {
    const html = await readFile(new URL('../../effetune.html', import.meta.url), 'utf8');
    const heading = html.match(/<h1>[\s\S]*?<\/h1>/)[0];
    const css = await readFile(new URL('../../css/effetune.css', import.meta.url), 'utf8');
    const english = parseCommentedJSON(await readFile(new URL('../../js/locales/en.json5', import.meta.url), 'utf8'));
    const hint = english['ui.network.effectsRequestUnavailable'];
    const bundle = await build({
      stdin: {
        resolveDir: fileURLToPath(new URL('../../', import.meta.url)),
        contents: `
          import { IntegratedRemoteEffects } from './js/remote/integrated-remote-effects.js';
          import { UIManager } from './js/ui-manager.js';
          import { StateManager } from './js/ui/state-manager.js';
          const api = Object.fromEntries([
            ['getConnection', 'get-connection'], ['requestConnection', 'request-connection'],
            ['cancelConnectionRequest', 'cancel-connection-request'], ['disconnect', 'disconnect']
          ].map(([method, channel]) => [method, (...args) => {
            const result = window.fixtureIPC(channel, ...args);
            if (method === 'requestConnection') window.lastRequest = result;
            return result;
          }]));
          api.onEvent = () => () => {};
          window.notifications = [];
          window.uiManager = Object.assign(Object.create(UIManager.prototype), {
            t: key => key, transientMessageTimer: null, transientMessageRevision: 0,
            stateManager: Object.assign(Object.create(StateManager.prototype), {
              errorDisplay: document.getElementById('errorDisplay')
            })
          });
          window.effects = new IntegratedRemoteEffects({
            container: document.querySelector('section'), api,
            translate: (key, fallback) => key === 'ui.network.effectsRequestUnavailable' ? ${JSON.stringify(hint)} : fallback,
            reportError: message => {
              notifications.push(message);
              uiManager.setError(message, true);
            }
          });
          window.ready = effects.selectPlayer({ id: 'uuid:bedroom', name: 'Bedroom PC' });
        `
      }, bundle: true, write: false, format: 'esm', platform: 'browser'
    });
    browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
    const page = await browser.newPage();
    await page.clock.install();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.exposeFunction('fixtureIPC', async (channel, ...args) => {
      calls.push({ channel, args });
      return handlers.get(`remote-client:${channel}`)({ sender }, ...args);
    });
    await page.route('http://localhost/**', route => route.fulfill({
      contentType: 'text/html', body: new URL(route.request().url()).pathname === '/remote.html'
        ? `<!doctype html><button>Change connection</button><script>
            window.addEventListener('message', event => {
              if (event.source !== parent || event.origin !== location.origin) return;
              const port = event.ports[0];
              document.querySelector('button').onclick = () => port.postMessage({ type: 'change-connection' });
            });
            parent.postMessage({ type: 'effetune-remote-ready' }, location.origin);
          </script>`
        : `<!doctype html><header class="title-container">${heading}</header><section></section>`
    }));
    await page.goto('http://localhost/effects-fixture');
    await page.addStyleTag({ content: css.replace('@import url("effetune-theme.css");', '') });
    await page.addScriptTag({ type: 'module', content: bundle.outputFiles[0].text });
    await page.evaluate(() => window.ready);
    assert.equal(await page.locator('section [role="status"]').textContent(), 'Effect editing unavailable');
    assert.deepEqual(await page.evaluate(() => notifications), []);
    await page.getByRole('button', { name: 'Connect effects', exact: true }).click();
    await page.evaluate(() => window.lastRequest);
    await page.waitForFunction(() => notifications.length === 1);
    assert.equal(await page.locator('h1 #errorDisplay').innerText(), hint);
    assert.match(hint, /Allow remote control.*refresh devices and try again/);
    assert.equal(await page.locator('#errorDisplay').isVisible(), true);
    await page.clock.fastForward(5000);
    assert.equal(await page.locator('#errorDisplay').innerText(), '');
    assert.equal(await page.locator('#errorDisplay').evaluate(element => element.classList.contains('error-message')), false);
    assert.equal(pairing, null);
    assert.equal(calls.filter(call => call.channel === 'request-connection').length, 1);
    await page.evaluate(() => effects.selectPlayer({ id: 'uuid:bedroom', name: 'Bedroom PC' }));
    assert.equal(await page.evaluate(() => notifications.length), 1, 'a status refresh must not repeat the error');

    origin = 'http://192.168.1.20:8080';
    await page.getByRole('button', { name: 'Connect effects', exact: true }).click();
    await pairingStarted;
    const pendingRename = await page.evaluate(() => {
      const requestId = effects.requestId;
      const generation = effects.generation;
      effects.updatePlayerName('Listening room PC');
      return { sameRequest: effects.requestId === requestId, sameGeneration: effects.generation === generation };
    });
    assert.deepEqual(pendingRename, { sameRequest: true, sameGeneration: true });
    assert.equal(await page.locator('.pipeline-title').textContent(), 'Effect Pipeline · Listening room PC');
    assert.equal(await page.locator('section [role="status"]').textContent(), 'Waiting for approval');
    assert.equal(pairing.playerId, 'uuid:bedroom');
    assert.equal(pairing.signal.aborted, false);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.evaluate(() => window.lastRequest);
    assert.equal(pairing.signal.aborted, true);
    assert.equal(await page.locator('iframe').count(), 0);

    pairingStarted = new Promise(resolve => { announcePairing = resolve; });
    await page.getByRole('button', { name: 'Connect effects', exact: true }).click();
    await pairingStarted;
    pairing.resolve({ status: 'approved', token: 'fixture-token' });
    assert.deepEqual(await page.evaluate(() => window.lastRequest), { ok: true }, JSON.stringify(diagnostics));
    await page.waitForFunction(() => effects.port !== null);
    const savedConnection = await readFile(path.join(scratch, 'remote-connections.json'), 'utf8');
    const connectedRename = await page.evaluate(() => {
      const frame = effects.frame;
      const generation = effects.generation;
      const port = effects.port;
      effects.connectionId = 'fixture-connection';
      effects.updatePlayerName('Studio PC');
      return { sameFrame: effects.frame === frame, samePort: effects.port === port,
        connectionId: effects.connectionId, sameGeneration: effects.generation === generation };
    });
    assert.deepEqual(connectedRename, { sameFrame: true, samePort: true,
      connectionId: 'fixture-connection', sameGeneration: true });
    assert.equal(await page.locator('section > .pipeline-header').count(), 0);
    assert.equal(await page.locator('iframe').getAttribute('title'), 'Effect Pipeline · Studio PC');
    assert.equal(await readFile(path.join(scratch, 'remote-connections.json'), 'utf8'), savedConnection, 'a name change preserves existing approval');
    assert.deepEqual(pairingRequests, ['uuid:bedroom', 'uuid:bedroom'], 'a name change must not request approval again');
    origin = 'http://192.168.1.21:8080';
    await page.frameLocator('iframe').getByRole('button', { name: 'Change connection', exact: true }).click();
    await page.waitForFunction(() => effects.frame === null);
    assert.equal(await page.locator('iframe').count(), 0);
    pairingStarted = new Promise(resolve => { announcePairing = resolve; });
    await page.getByRole('button', { name: 'Connect effects', exact: true }).click();
    await pairingStarted;
    assert.equal(pairing.origin, origin);
    assert.equal(await page.locator('iframe').count(), 0, 'replacement waits for new approval');
    assert.equal(calls.filter(call => call.channel === 'request-connection').at(-1).args[2], true);
    pairing.resolve({ status: 'approved', token: 'replacement-fixture-token' });
    assert.deepEqual(await page.evaluate(() => window.lastRequest), { ok: true });
    await page.waitForFunction(() => effects.frame !== null);
    assert.deepEqual(pairingRequests, ['uuid:bedroom', 'uuid:bedroom', 'uuid:bedroom'], 'Change connection requests replacement approval');
    assert.deepEqual(JSON.parse(await readFile(path.join(scratch, 'remote-connections.json'), 'utf8')),
      { 'uuid:bedroom': `${origin}/?t=replacement-fixture-token` });
    assert.equal(await page.locator('iframe').getAttribute('title'), 'Effect Pipeline · Studio PC');
    assert.equal(calls.filter(call => call.channel === 'cancel-connection-request').length, 1);
    assert.equal(calls.filter(call => call.channel === 'request-connection').length, 4);
    assert.equal(await page.evaluate(() => notifications.length), 1);
    assert.deepEqual(errors, []);
    assert.deepEqual(diagnostics, []);
    await page.evaluate(() => effects.dispose());
  } finally {
    await browser?.close();
    dispose();
    await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
