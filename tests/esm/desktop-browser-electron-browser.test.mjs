import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { createServer as createSecureServer } from 'node:https';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { _electron as electron } from 'playwright';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const fixtureRoot = path.join(repoRoot, 'tests/fixtures/desktop-browser');

async function startFixture({ secure = true } = {}) {
  const [key, cert, source, audio] = await Promise.all([
    readFile(path.join(fixtureRoot, 'key.pem')),
    readFile(path.join(fixtureRoot, 'cert.pem')),
    readFile(path.join(fixtureRoot, 'source.html')),
    readFile(path.join(fixtureRoot, 'stereo.webm'))
  ]);
  const handler = (request, response) => {
    const url = new URL(request.url, 'https://localhost');
    response.setHeader('Cache-Control', 'no-store');
    if (url.pathname === '/user-agent') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(request.headers['user-agent']);
    } else if (url.pathname === '/redirect') {
      response.writeHead(302, { Location: '/source?redirected=1' }).end();
    } else if (url.pathname === '/popup') {
      let body = '';
      request.on('data', chunk => { body += chunk; });
      request.on('end', () => {
        const payload = JSON.stringify({ kind: 'fixture-auth-complete', method: request.method, body })
          .replace(/[<>\u2028\u2029]/g, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
        response.writeHead(200, { 'Content-Type': 'text/html', 'Set-Cookie': 'browserFixture=present; Path=/; Max-Age=3600; Secure; SameSite=Lax' });
        response.end(`<script>opener.postMessage(${payload}, location.origin); close();</script>`);
      });
    } else if (url.pathname === '/stereo.webm') {
      response.writeHead(200, { 'Content-Type': 'audio/webm', 'Content-Length': audio.length });
      response.end(audio);
    } else {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(source);
    }
  };
  const server = secure ? createSecureServer({ key, cert }, handler) : createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    origin: `${secure ? 'https' : 'http'}://127.0.0.1:${server.address().port}`,
    async close() {
      server.closeAllConnections();
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  };
}

async function launch(profile, origin) {
  const application = await electron.launch({
    args: [path.join(repoRoot, 'tests/helpers/desktop-browser-electron-main.cjs'), `--user-data-dir=${profile}`],
    env: { ...process.env, EFFETUNE_BROWSER_FIXTURE_ORIGIN: origin },
    timeout: 20_000
  });
  try {
    const deadline = Date.now() + 25_000;
    let page;
    while (Date.now() < deadline) {
      page = application.windows().find(candidate => candidate.url().includes('effetune.html'));
      if (page) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(page, 'production app must open effetune.html');
    page.on('pageerror', error => process.stderr.write(`Browser integration renderer: ${error.message}\n`));
    page.on('console', message => {
      if (message.type() === 'error' && message.text().startsWith('Browser ')) {
        process.stderr.write(`Browser integration console: ${message.text()}\n`);
      }
    });
    await page.waitForFunction(() => window.app?.initialized && window.audioManager?.workletNode, null, { timeout: 25_000 });
    return { application, page };
  } catch (error) {
    await closeApplication(application);
    throw error;
  }
}

async function closeApplication(application) {
  if (!application) return;
  const processHandle = application.process();
  if (processHandle.exitCode !== null || processHandle.signalCode !== null) return;
  let timer;
  let shutdownFailure;
  try {
    await Promise.race([application.close(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Electron test shutdown timed out')), 15_000);
    })]);
  } catch (error) {
    shutdownFailure = error;
    const child = application.process();
    process.stderr.write(`Browser integration shutdown required cleanup: ${error.message}\n`);
    if (child.exitCode === null) {
      if (process.platform === 'win32') {
        await new Promise(resolve => execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, resolve));
      } else child.kill('SIGKILL');
    }
  } finally { clearTimeout(timer); }
  if (shutdownFailure) throw shutdownFailure;
}

async function browserEvaluate(application, expression) {
  return application.evaluate((_electron, code) => {
    const contents = globalThis.browserFixture.contents();
    if (!contents) throw new Error('The browser fixture page is unavailable.');
    return contents.executeJavaScript(`(async () => {
      let timer;
      try {
        return await Promise.race([(async () => (${code}))(), new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Browser fixture operation timed out')), 8000);
        })]);
      } finally { clearTimeout(timer); }
    })()`, true);
  }, expression);
}

async function installMeters(page) {
  await page.evaluate(() => {
    window.browserTestMeters?.dispose();
    const manager = window.audioManager;
    const context = manager.audioContext;
    const createMeters = node => {
      const splitter = context.createChannelSplitter(2);
      node.connect(splitter);
      const meters = [0, 1].map(channel => {
        const meter = context.createAnalyser();
        meter.fftSize = 8192;
        splitter.connect(meter, channel);
        return meter;
      });
      const silent = context.createGain();
      silent.gain.value = 0;
      meters.forEach(meter => meter.connect(silent));
      silent.connect(context.destination);
      return { meters, splitter, silent, node };
    };
    const input = createMeters(window.uiManager.browserView.input.sourceNode);
    const output = createMeters(manager.ioManager.outputGainNode);
    window.browserTestMeters = {
      async measure() {
        const result = { input: [0, 0], output: [0, 0] };
        for (let sample = 0; sample < 5; sample++) {
          await new Promise(resolve => setTimeout(resolve, 100));
          for (const [name, resource] of [['input', input], ['output', output]]) {
            resource.meters.forEach((meter, channel) => {
              const data = new Float32Array(meter.fftSize);
              meter.getFloatTimeDomainData(data);
              result[name][channel] += data.reduce((sum, value) => sum + value * value, 0) / data.length;
            });
          }
        }
        return Object.fromEntries(Object.entries(result).map(([key, values]) =>
          [key, values.map(value => Math.sqrt(value / 5))]));
      },
      dispose() {
        for (const resource of [input, output]) {
          try { resource.node.disconnect(resource.splitter); } catch { /* A graph rebuild may already detach the tap. */ }
          resource.splitter.disconnect();
          resource.meters.forEach(meter => meter.disconnect());
          resource.silent.disconnect();
        }
      }
    };
  });
}

function assertRatio(actual, reference, expected, tolerance, label) {
  const ratios = actual.map((value, index) => value / reference[index]);
  assert.ok(ratios.every((value, index) => Math.abs(value - expected[index]) < tolerance),
    `${label}: ${JSON.stringify({ actual, reference, ratios, expected, tolerance })}`);
}

function fixtureToneLevels(measurement) {
  return [measurement.tones[0][0], measurement.tones[1][1]];
}

test('desktop Browser captures HTTP and MSE playback through the production DSP and owns its resources', {
  timeout: 100_000
}, async t => {
  const profile = await realpath(await mkdtemp(path.join(os.tmpdir(), 'effetune-desktop-browser-')));
  const fixture = await startFixture();
  let application;
  let page;
  const stage = name => process.stdout.write(`Browser integration: ${name}\n`);
  const deadline = setTimeout(() => {
    process.stderr.write('Browser integration reached its cleanup deadline.\n');
    void closeApplication(application).catch(error => process.stderr.write(`${error.message}\n`));
  }, 70_000);
  t.after(async () => {
    clearTimeout(deadline);
    await application?.evaluate(() => globalThis.browserFixture.closeObserver()).catch(() => {});
    if (page && !page.isClosed()) {
      await page.evaluate(() => window.uiManager?.browserView?.input.release()).catch(error => {
        process.stderr.write(`Browser integration capture cleanup: ${error.message}\n`);
      });
    }
    let shutdownError;
    try { await closeApplication(application); } catch (error) { shutdownError = error; }
    await fixture.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    assert.equal(await realpath(profile).then(() => true, () => false), false, 'isolated profile was removed');
    if (shutdownError) throw shutdownError;
  });
  try {
    await writeFile(path.join(profile, 'config.json'), JSON.stringify({
      onboardingTourShown: true, language: 'en', checkForUpdatesOnStartup: false,
    }));
    await writeFile(path.join(profile, 'audio-preferences.json'), JSON.stringify({
      inputDeviceId: '__effetune_no_audio_input__', sampleRate: 48000, outputDeviceId: 'default'
    }));
    ({ application, page } = await launch(profile, fixture.origin));
    await page.locator('#browserButton').click();
    try {
      await page.waitForFunction(() => window.uiManager.browserView?.input.active, null, { timeout: 15_000 });
    } catch (error) {
      const diagnostic = await page.evaluate(async () => ({
        state: await window.electronAPI.browser.getState(),
        status: window.uiManager.browserView.inputStatus,
        active: window.uiManager.browserView.input.active,
        revision: window.uiManager.browserView.input.revision,
        pending: Boolean(window.uiManager.browserView.input.pending),
        stream: Boolean(window.uiManager.browserView.input.stream),
        snapshot: window.audioManager.ioManager.getInputSnapshot(),
        power: window.audioManager.powerPolicyController.getSnapshot()
      }));
      throw new Error(`First-click capture did not settle: ${JSON.stringify(diagnostic)}`, { cause: error });
    }
    await page.evaluate(() => window.uiManager.browserView.input.pending);
    const initialInput = await page.evaluate(() => ({
      snapshot: window.audioManager.ioManager.getInputSnapshot(),
      active: window.uiManager.browserView.input.active,
      browserStream: Boolean(window.uiManager.browserView.input.stream),
      power: window.audioManager.powerPolicyController.getSnapshot(),
      tracks: (window.uiManager.browserView.input.stream?.getTracks() || []).map(track => ({
        kind: track.kind, state: track.readyState, settings: track.getSettings()
      }))
    }));
    const tracks = initialInput.tracks;
    assert.ok(tracks.some(track => track.kind === 'audio' && track.state === 'live'), JSON.stringify(initialInput));
    const settings = tracks.find(track => track.kind === 'audio').settings;
    assert.equal(settings.channelCount, 2);
    assert.equal(settings.echoCancellation, false);
    assert.equal(settings.noiseSuppression, false);
    assert.equal(settings.autoGainControl, false);
    stage('first-click live stereo capture');
    await page.evaluate(async () => {
      window.audioManager.pipelineA = [];
      await window.audioManager.setPipeline([]);
      window.audioManager.ioManager.outputGainNode.gain.value = 1;
    });

    await page.evaluate(url => window.electronAPI.browser.navigate(url), `${fixture.origin}/source`);
    await browserEvaluate(application, 'startFixture()');
    // Probe the visible, permission-granted app, not the hidden observer document.
    const hasAudioOutput = await page.evaluate(async () =>
      (await navigator.mediaDevices.enumerateDevices()).some(device => device.kind === 'audiooutput'));
    if (hasAudioOutput) {
      const observerSettings = await application.evaluate(() => globalThis.browserFixture.createObserver());
      assert.equal(observerSettings.channelCount, 2);
    }
    await installMeters(page);
    await page.waitForTimeout(500);
    const unity = await page.evaluate(() => browserTestMeters.measure());
    const physicalUnity = hasAudioOutput ? await application.evaluate(() => globalThis.browserFixture.measureOutput()) : null;
    assert.ok(unity.input.every(value => value > 0.005), `live input: ${JSON.stringify(unity)}`);
    assertRatio(unity.output, unity.input, [1, 1], 0.04, 'unity DSP');
    stage('HTTP input and unity DSP');

    await page.evaluate(async () => {
      const plugins = ['L', 'R'].map((channel, index) => {
        const plugin = window.pluginManager.createPlugin('Volume');
        plugin.id = `browser-fixture-volume-${index}`;
        plugin.channel = channel;
        plugin.setParameters({ vl: index === 0 ? -6.0206 : -12.0412 });
        return plugin;
      });
      window.audioManager.pipelineA = plugins;
      await window.audioManager.setPipeline(plugins);
    });
    await installMeters(page);
    await page.waitForTimeout(350);
    const processed = await page.evaluate(() => browserTestMeters.measure());
    const physicalProcessed = hasAudioOutput ? await application.evaluate(() => globalThis.browserFixture.measureOutput()) : null;
    assertRatio(processed.output, processed.input, [0.5, 0.25], 0.03, 'left/right production Volume processing');
    stage('independent left/right DSP gains');

    await page.evaluate(() => { window.audioManager.ioManager.outputGainNode.gain.value = 0; });
    await page.waitForTimeout(350);
    const zero = await page.evaluate(() => browserTestMeters.measure());
    const physicalZero = hasAudioOutput ? await application.evaluate(() => globalThis.browserFixture.measureOutput()) : null;
    assertRatio(zero.input, unity.input, [1, 1], 0.04, 'input survives output mute without feedback');
    assert.ok(zero.output.every(value => value === 0));
    stage('zero processing output preserves live input');
    await page.evaluate(() => { window.audioManager.ioManager.outputGainNode.gain.value = 1; });

    await page.evaluate(async () => {
      await window.audioManager.setPipeline([]);
      await window.uiManager.showEffectPipelineView();
    });
    await installMeters(page);
    assert.equal(await page.evaluate(() => window.uiManager.browserView.input.selected), true);
    await page.evaluate(url => window.electronAPI.browser.navigate(url), `${fixture.origin}/source?mse=1`);
    await browserEvaluate(application, 'startFixture()');
    await page.waitForTimeout(350);
    const mse = await page.evaluate(() => browserTestMeters.measure());
    assert.ok(mse.input.every(value => value > 0.005), 'MSE supplies live stereo audio');
    assertRatio(mse.output, mse.input, [1, 1], 0.04, 'MSE bypass/unity');
    stage('MSE navigation and unity DSP');

    await page.locator('#browserButton').click();
    await page.evaluate(async url => {
      const address = window.uiManager.browserView.address;
      address.value = 'address currently being edited';
      address.focus();
      await window.electronAPI.browser.navigate(url);
    }, `${fixture.origin}/redirect`);
    assert.equal((await page.evaluate(() => window.electronAPI.browser.getState())).url, `${fixture.origin}/source?redirected=1`);
    assert.equal(await page.evaluate(() => window.uiManager.browserView.address.value), 'address currently being edited');
    stage('redirect and in-progress address editing');

    await page.locator('#browserButton').click();
    await page.locator('#settingsMenuButton').click();
    await page.locator('#settingsMenu.show').waitFor({ state: 'visible', timeout: 3000 });
    await page.evaluate(() => window.uiManager.browserView.syncPresentation());
    const nativeVisible = await application.evaluate(({ BrowserWindow }) => {
      const main = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('effetune.html'));
      const remote = globalThis.browserFixture.contents();
      return main.contentView.children.find(view => view.webContents === remote).getVisible();
    });
    assert.equal(nativeVisible, false, 'native content must leave the Settings menu clickable');
    await page.locator('#audioConfigSettingsButton').click();
    await page.locator('.audio-config-dialog').waitFor({ state: 'visible', timeout: 5000 });
    await page.locator('#cancel-button').click();
    await page.locator('.audio-config-dialog').waitFor({ state: 'detached', timeout: 3000 });
    stage('Settings menu lower item and dialog remain clickable');

    const isolation = await browserEvaluate(application, `({ node: typeof require, api: typeof electronAPI,
      microphone: await navigator.mediaDevices.getUserMedia({audio:true}).then(() => 'allowed', () => 'denied') })`);
    assert.deepEqual(isolation, { node: 'undefined', api: 'undefined', microphone: 'denied' });
    stage('remote page isolation and microphone denial');
    const auth = await browserEvaluate(application, `new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('POST popup did not return through opener')), 5000);
      window.addEventListener('message', event => {
        if (event.origin === location.origin && event.data?.kind === 'fixture-auth-complete') {
          clearTimeout(timer); resolve(event.data);
        }
      }, {once:true});
      window.open('about:blank', 'fixture-auth', 'width=350,height=300');
      const form = document.createElement('form');
      form.method = 'POST'; form.action = '/popup'; form.target = 'fixture-auth';
      const proof = document.createElement('input'); proof.name = 'proof'; proof.value = 'fixture-post';
      form.append(proof); document.body.append(form); form.submit(); form.remove();
    })`);
    assert.equal(auth.method, 'POST');
    assert.equal(auth.body, 'proof=fixture-post');
    stage('POST popup preserves opener and postMessage');
    assert.match(await browserEvaluate(application, 'document.cookie'), /browserFixture=present/);
    const bookmarks = [{ name: 'Fixture music', url: `${fixture.origin}/source` }];
    await page.evaluate(settings => window.electronAPI.browser.saveSettings(settings), { bookmarks, startPage: bookmarks[0].url });
    const released = await page.evaluate(async () => {
      browserTestMeters.dispose();
      const tracks = window.uiManager.browserView.input.stream.getTracks();
      await window.uiManager.browserView.input.release();
      return { selected: window.uiManager.browserView.input.selected, tracks: tracks.map(track => track.readyState) };
    });
    assert.equal(released.selected, false);
    assert.ok(released.tracks.every(state => state === 'ended'));
    stage('explicit Browser release ends every capture track');
    await application.evaluate(() => globalThis.browserFixture.closeObserver());
    await closeApplication(application);
    application = null;
    stage('first app shutdown');

    ({ application, page } = await launch(profile, fixture.origin));
    const saved = await page.evaluate(() => window.electronAPI.browser.getState());
    assert.deepEqual(saved.settings.bookmarks, bookmarks);
    assert.equal(saved.captureActive, false, 'startup never auto-captures');
    await page.locator('#browserButton').click();
    await page.waitForFunction(url => {
      const state = window.uiManager.browserView?.state;
      return state?.url === url && state.loading === false;
    }, bookmarks[0].url, { timeout: 10_000 });
    await page.evaluate(() => window.uiManager.browserView.input.pending);
    assert.match(await browserEvaluate(application, 'document.cookie'), /browserFixture=present/);
    stage('restart cookie, bookmark and start-page persistence');
    t.diagnostic(JSON.stringify({ versions: await application.evaluate(() => process.versions), unity, processed, mse,
      physicalUnity, physicalProcessed, physicalZero }));
    await t.test('physical output preserves DSP gains without direct sound leakage', {
      skip: hasAudioOutput ? false : 'System-loopback measurement requires an available audio output device.'
    }, () => {
      const reference = fixtureToneLevels(physicalUnity);
      assert.ok(reference.every(value => value > 0.0001), 'output observer must hear both fixture tones');
      assertRatio(fixtureToneLevels(physicalProcessed), reference, [0.5, 0.25], 0.1,
        'physical fixture tones without double playback');
      assert.ok(fixtureToneLevels(physicalZero).every((value, index) => value < reference[index] * 0.03),
        `no fixture tone leakage at zero processing gain: ${JSON.stringify({ physicalZero, physicalUnity })}`);
      stage('physical fixture-tone gains and direct-sound suppression');
    });
  } finally {
    clearTimeout(deadline);
  }
});

test('Double Blind Test survives Browser playback controls and returns to the same running trial', { timeout: 45_000 }, async t => {
  const profile = await realpath(await mkdtemp(path.join(os.tmpdir(), 'effetune-browser-dbt-')));
  const fixture = await startFixture();
  let application;
  let page;
  t.after(async () => {
    let shutdownError;
    try {
      if (page && !page.isClosed()) await page.evaluate(async () => {
        await window.uiManager?.doubleBlindTest?.exit();
        await window.uiManager?.browserView?.input.release();
      });
    } catch (error) { shutdownError = error; }
    try { await closeApplication(application); } catch (error) { shutdownError ||= error; }
    await fixture.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    if (shutdownError) throw shutdownError;
  });
  await writeFile(path.join(profile, 'config.json'), JSON.stringify({
    onboardingTourShown: true, language: 'en', checkForUpdatesOnStartup: false
  }));
  await writeFile(path.join(profile, 'audio-preferences.json'), JSON.stringify({
    inputDeviceId: '__effetune_no_audio_input__', sampleRate: 48000, outputDeviceId: 'default'
  }));
  ({ application, page } = await launch(profile, fixture.origin));
  await page.locator('#browserButton').click();
  await page.waitForFunction(url => window.uiManager.browserView?.input.active &&
    window.uiManager.browserView.state.url === url && !window.uiManager.browserView.state.loading,
  `${fixture.origin}/source?default-start-page=1`);
  await browserEvaluate(application, 'startFixture()');
  await page.evaluate(async () => {
    const manager = window.audioManager;
    manager.pipelineA = [window.pluginManager.createPlugin('Volume')];
    manager.pipelineB = [window.pluginManager.createPlugin('Volume')];
    await manager.setPipeline(manager.pipelineA);
    window.uiManager.updatePipelineMenuState();
    const { updateApplicationMenu } = await import('./js/electron/menuIntegration.js');
    await updateApplicationMenu(true);
    window.dbtBrowserCapture = window.uiManager.browserView.input.stream;
  });
  assert.equal(await application.evaluate(({ Menu }) => {
    const item = Menu.getApplicationMenu().getMenuItemById('file.doubleBlindTest');
    if (!item?.enabled) return false;
    item.click();
    return true;
  }), true, 'the real native menu permits a fresh blind test from Browser');
  const panel = page.locator('.double-blind-test');
  await panel.waitFor({ state: 'visible' });
  assert.equal(await application.evaluate(({ BrowserWindow }) => {
    const main = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('effetune.html'));
    return main.contentView.children.find(view => view.webContents === globalThis.browserFixture.contents()).getVisible();
  }), false, 'native menu entry hides the Browser page before exposing the test');
  await panel.locator('.dbt-count-input').fill('3');
  await panel.locator('.dbt-start-abx').click();
  await page.waitForFunction(() => window.uiManager.doubleBlindTest.testRunning &&
    !window.uiManager.doubleBlindTest._startPending);
  await panel.locator('.dbt-vote-a').click();
  await panel.locator('.dbt-switch-x').click();
  const before = await page.evaluate(() => {
    const test = window.uiManager.doubleBlindTest;
    window.dbtBrowserController = test;
    window.dbtBrowserPanel = test.container;
    return [test.testRunning, test.totalCount, test.correctCount, test.prefACount,
      test._aIsPhysicalA, test._xIsA, test._activeLabel];
  });
  await page.locator('#browserButton').click();
  await panel.waitFor({ state: 'hidden' });
  assert.equal(await application.evaluate(({ BrowserWindow }) => {
    const main = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('effetune.html'));
    return main.contentView.children.find(view => view.webContents === globalThis.browserFixture.contents()).getVisible();
  }), true, 'the native Browser page is available for playback controls during the test');
  await browserEvaluate(application, '(document.getElementById("player").pause(), true)');
  assert.equal(await browserEvaluate(application, 'document.getElementById("player").paused'), true);
  await browserEvaluate(application, 'startFixture()');
  assert.equal(await browserEvaluate(application, 'document.getElementById("player").paused'), false);
  // Browser toolbar keys must not reach the hidden test's document shortcuts.
  await page.locator('#browserButton').focus();
  await page.keyboard.press('b');
  await page.keyboard.press('q');
  await page.locator('#effectPipelineButton').click();
  await panel.waitFor({ state: 'visible' });
  const after = await page.evaluate(() => {
    const ui = window.uiManager;
    const test = ui.doubleBlindTest;
    return {
      state: [test.testRunning, test.totalCount, test.correctCount, test.prefACount,
        test._aIsPhysicalA, test._xIsA, test._activeLabel],
      sameController: test === window.dbtBrowserController,
      samePanel: test.container === window.dbtBrowserPanel && test.container.isConnected,
      captureRetained: ui.browserView.input.stream === window.dbtBrowserCapture &&
        ui.browserView.input.selected && ui.browserView.input.active &&
        ui.browserView.input.stream.getAudioTracks().every(track => track.readyState === 'live'),
      pipelineHidden: document.querySelector('.main-container').children.length === 0,
      urlPrivate: !ui.urlReflectionEnabled
    };
  });
  assert.deepEqual(after, { state: before, sameController: true, samePanel: true,
    captureRetained: true, pipelineHidden: true, urlPrivate: true });
  await panel.locator('.dbt-vote-a').click();
  assert.equal(await page.evaluate(() => window.uiManager.doubleBlindTest.totalCount), 2,
    'voting continues on the original test after returning');
});

test('Browser toolbar, bookmarks and menu preserve automatic audio selection', { timeout: 45_000 }, async t => {
  const profile = await realpath(await mkdtemp(path.join(os.tmpdir(), 'effetune-desktop-browser-')));
  const fixture = await startFixture();
  let application;
  let page;
  t.after(async () => {
    let shutdownError;
    try {
      if (page && !page.isClosed()) await page.evaluate(() => window.uiManager?.browserView?.input.release());
    } catch (error) { shutdownError = error; }
    try { await closeApplication(application); } catch (error) { shutdownError ||= error; }
    await fixture.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    if (shutdownError) throw shutdownError;
  });
  await writeFile(path.join(profile, 'config.json'), JSON.stringify({
    onboardingTourShown: true, language: 'en', checkForUpdatesOnStartup: false
  }));
  await writeFile(path.join(profile, 'audio-preferences.json'), JSON.stringify({
    inputDeviceId: '__effetune_no_audio_input__', sampleRate: 48000, outputDeviceId: 'default'
  }));
  ({ application, page } = await launch(profile, fixture.origin));
  const browserButton = page.locator('#browserButton');
  const toolbar = page.locator('.browser-toolbar');
  const button = key => page.locator(`.browser-toolbar [data-browser-label="${key}"]`);
  const menuItem = key => page.locator(`.browser-menu [data-browser-label="${key}"]`);
  await browserButton.click();
  await page.waitForFunction(() => window.uiManager.browserView?.input.active);
  await page.waitForFunction(url => window.uiManager.browserView.state.url === url &&
    !window.uiManager.browserView.state.loading, `${fixture.origin}/source?default-start-page=1`);
  assert.equal((await page.evaluate(() => window.electronAPI.browser.getState())).settings.startPage, '',
    'default navigation does not replace the empty saved start page');
  assert.equal(await toolbar.count(), 1, 'navigation occupies one toolbar');
  assert.equal(await toolbar.locator('button').count(), 7);
  assert.equal(await toolbar.locator('button svg').count(), 7, 'toolbar buttons use SVG icons');
  assert.equal(await toolbar.locator('select').count(), 0);
  assert.equal(await page.locator('[data-browser-label="resume"], [data-browser-label="input"]').count(), 0);
  assert.equal(await page.locator('.browser-status').isVisible(), false, 'normal operation has no processing status');
  const url = `${fixture.origin}/source`;
  await page.locator('.browser-address').fill(url);
  await page.locator('.browser-address').press('Enter');
  await page.waitForFunction(url => window.uiManager.browserView.state.url === url &&
    !window.uiManager.browserView.state.loading, url);
  await browserEvaluate(application, 'startFixture()');
  // Playback can start before the captured input receives its first audio frames.
  await installMeters(page);
  try {
    const deadline = Date.now() + 10_000;
    let ready = false;
    do {
      const { input } = await page.evaluate(() => window.browserTestMeters.measure());
      ready = input.every(value => value > 0.01);
    } while (!ready && Date.now() < deadline);
    assert.ok(ready, 'Fixture audio must reach Browser capture before measuring the mix');
  } finally {
    await page.evaluate(() => window.browserTestMeters.dispose());
  }
  const mixed = await page.evaluate(async () => {
    const manager = window.audioManager;
    const io = manager.ioManager;
    const preferences = window.audioPreferences;
    const previous = { inputDeviceId: preferences.inputDeviceId,
      useInputWithPlayer: preferences.useInputWithPlayer, gain: io.outputGainNode.gain.value };
    const context = manager.audioContext;
    const oscillator = context.createOscillator();
    const level = context.createGain();
    const device = context.createMediaStreamDestination();
    const splitter = context.createChannelSplitter(2);
    const analyser = context.createAnalyser();
    const silent = context.createGain();
    analyser.fftSize = 8192;
    oscillator.frequency.value = 1973;
    level.gain.value = 0.02;
    silent.gain.value = 0;
    oscillator.connect(level).connect(device);
    oscillator.start();
    try {
      await manager.setPipeline([]);
      io.outputGainNode.gain.value = 0;
      manager.contextManager.workletNode.connect(splitter);
      splitter.connect(analyser, 0);
      analyser.connect(silent).connect(context.destination);
      preferences.inputDeviceId = 'default';
      io._adoptInputStream(device.stream, { adoptPipelineSource: false });
      const results = [];
      for (const enabled of [false, true]) {
        preferences.useInputWithPlayer = enabled;
        await manager.powerPolicyController.refreshPlaybackInputRouting();
        await new Promise(resolve => setTimeout(resolve, 250));
        const data = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(data);
        results.push([713, 1973].map(frequency => {
          let sine = 0;
          let cosine = 0;
          for (let index = 0; index < data.length; index++) {
            const phase = 2 * Math.PI * frequency * index / context.sampleRate;
            sine += data[index] * Math.sin(phase);
            cosine += data[index] * Math.cos(phase);
          }
          return 2 * Math.hypot(sine, cosine) / data.length;
        }));
      }
      return results;
    } finally {
      preferences.inputDeviceId = previous.inputDeviceId;
      preferences.useInputWithPlayer = previous.useInputWithPlayer;
      io.releaseAudioInput({ reason: 'test-device-cleanup', disconnect: true });
      oscillator.stop();
      oscillator.disconnect();
      level.disconnect();
      splitter.disconnect();
      analyser.disconnect();
      silent.disconnect();
      await manager.powerPolicyController.refreshPlaybackInputRouting();
      io.outputGainNode.gain.value = previous.gain;
    }
  });
  assert.ok(mixed.every(levels => levels.every(value => value > 0.004)),
    `Browser and known device tones remain mixed with either Player option: ${JSON.stringify(mixed)}`);
  const localPlayback = await page.evaluate(async file => {
    const player = await window.uiManager.createAudioPlayer([]);
    const loaded = await player.loadFiles([file]);
    return { loaded, browserActive: window.uiManager.browserView.input.active,
      browserSelected: window.uiManager.browserView.input.selected };
  }, path.join(fixtureRoot, 'stereo.webm'));
  assert.deepEqual(localPlayback, { loaded: true, browserActive: true, browserSelected: true },
    'starting local playback retains Browser capture');
  await browserButton.click();
  assert.equal(await page.evaluate(() => window.uiManager.audioPlayer.contextManager.getCurrentState().isPlaying), true,
    'selecting Browser retains local Player playback');
  await page.evaluate(() => window.uiManager.audioPlayer.stop());
  assert.equal(await page.evaluate(() => window.uiManager.browserView.input.active &&
    window.uiManager.browserView.input.selected), true, 'stopping local playback retains Browser capture');
  await page.locator('#effectPipelineButton').click();
  const retained = await page.evaluate(() => ({
    selected: window.uiManager.browserView.input.selected,
    live: window.uiManager.browserView.input.stream.getAudioTracks().every(track => track.readyState === 'live')
  }));
  assert.deepEqual(retained, { selected: true, live: true }, 'changing views retains Browser audio');
  await browserButton.click();
  await page.evaluate(() => { window.bookmarkCaptureBefore = window.uiManager.browserView.input.stream; });
  await button('bookmarks').click();
  const dialog = page.locator('.browser-bookmarks');
  await dialog.waitFor({ state: 'visible' });
  assert.equal(await application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('effetune.html'));
    return window.contentView.children.find(view => view.webContents === globalThis.browserFixture.contents()).getVisible();
  }), false, 'Bookmarks hides the native page while the dialog is open');
  assert.equal(await dialog.locator('.preset-dialog-empty').textContent(), 'No bookmarks yet.');
  await dialog.locator('.preset-dialog-name-input').fill('Fixture music');
  await dialog.locator('[data-browser-label="add"]').click();
  await dialog.locator('.preset-dialog-user-preset').waitFor();
  await dialog.locator('[data-browser-label="rename"]').click();
  await dialog.locator('.preset-dialog-rename-input').fill('Saved fixture');
  await dialog.locator('[data-browser-label="save"]').click();
  await page.waitForFunction(() => window.uiManager.browserView.state.settings.bookmarks[0]?.name === 'Saved fixture');
  await dialog.locator('[data-browser-label="close"]').click();
  assert.equal(await application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('effetune.html'));
    return window.contentView.children.find(view => view.webContents === globalThis.browserFixture.contents()).getVisible();
  }), true, 'closing Bookmarks restores the live native page');
  assert.equal(await page.evaluate(() => {
    const input = window.uiManager.browserView.input;
    return input.stream === window.bookmarkCaptureBefore && input.selected && input.active &&
      input.stream.getAudioTracks().every(track => track.readyState === 'live');
  }), true, 'opening and closing Bookmarks preserves the same Browser audio capture');
  await application.evaluate(() => {
    const contents = globalThis.browserFixture.contents();
    contents.focus();
    contents.sendInputEvent({ type: 'keyDown', keyCode: 'F6' });
    contents.sendInputEvent({ type: 'keyUp', keyCode: 'F6' });
  });
  await page.waitForFunction(() => document.activeElement?.classList.contains('browser-address'));
  await button('menu').click();
  assert.deepEqual(await page.locator('.browser-menu [role="menuitem"]').allTextContents(),
    ['Show start page', 'Open in default browser', 'Use as start page', 'Clear site data']);
  await menuItem('start').click();
  await page.waitForFunction(url => window.uiManager.browserView.state.settings.startPage === url, url);
  await browserEvaluate(application, '(document.cookie = "browserFixture=present; Path=/; Max-Age=3600; Secure; SameSite=Lax")');
  const bookmarks = [{ name: 'Saved fixture', url }];
  page.once('dialog', dialog => dialog.accept());
  await button('menu').click();
  await menuItem('clear').click();
  await page.waitForFunction(() => {
    const view = window.uiManager.browserView;
    return !view.confirming && !view.input.active && !view.state.url;
  });
  assert.deepEqual((await page.evaluate(() => window.electronAPI.browser.getState())).settings.bookmarks, bookmarks);
  await button('bookmarks').click();
  await dialog.locator('.preset-dialog-user-preset').click();
  await page.waitForFunction(url => {
    const view = window.uiManager.browserView;
    return view.input.active && view.state.url === url && !view.state.loading;
  }, url);
  assert.doesNotMatch(await browserEvaluate(application, 'document.cookie'), /browserFixture=present/);
  const preservedURL = `${fixture.origin}/source?preserved=1`;
  await page.locator('.browser-address').fill(preservedURL);
  await page.locator('.browser-address').press('Enter');
  await page.waitForFunction(url => window.uiManager.browserView.state.url === url &&
    !window.uiManager.browserView.state.loading, preservedURL);
  const captureTracks = await page.evaluateHandle(() => window.uiManager.browserView.input.stream.getTracks());
  await button('close').click();
  await page.waitForFunction(() => !window.uiManager.browserView.input.selected &&
    !document.body.classList.contains('view-browser'));
  assert.equal(await captureTracks.evaluate(tracks => tracks.every(track => track.readyState === 'ended')), true);
  await captureTracks.dispose();
  const afterClose = await application.evaluate(() => ({
    muted: globalThis.browserFixture.contents().isAudioMuted(),
    url: globalThis.browserFixture.contents().getURL()
  }));
  assert.deepEqual(afterClose, { muted: true, url: preservedURL }, 'Close keeps the page while muting original audio');
  assert.equal(await page.locator('#effectPipelineButton').getAttribute('aria-pressed'), 'true');
  await browserButton.click();
  await page.waitForFunction(url => window.uiManager.browserView.input.active &&
    window.uiManager.browserView.input.selected && window.uiManager.browserView.state.url === url &&
    !window.uiManager.browserView.state.loading, preservedURL);
  await button('bookmarks').click();
  await dialog.locator('[data-browser-label="remove"]').click();
  await dialog.locator('.preset-dialog-empty').waitFor();
  await dialog.press('Escape');
  assert.equal(await dialog.count(), 0);
});

test('Browser HTML fullscreen fills its window and restores layout without replacing capture', { timeout: 45_000 }, async t => {
  const profile = await realpath(await mkdtemp(path.join(os.tmpdir(), 'effetune-browser-fullscreen-')));
  const fixture = await startFixture();
  let application;
  t.after(async () => {
    let shutdownError;
    try { await closeApplication(application); } catch (error) { shutdownError = error; }
    await fixture.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    if (shutdownError) throw shutdownError;
  });
  await writeFile(path.join(profile, 'config.json'), JSON.stringify({
    onboardingTourShown: true, language: 'en', checkForUpdatesOnStartup: false
  }));
  await writeFile(path.join(profile, 'audio-preferences.json'), JSON.stringify({
    inputDeviceId: '__effetune_no_audio_input__', sampleRate: 48000, outputDeviceId: 'default'
  }));
  const launched = await launch(profile, fixture.origin);
  application = launched.application;
  const page = launched.page;
  await page.locator('#browserButton').click();
  await page.waitForFunction(() => window.uiManager.browserView?.input.active);
  const url = `${fixture.origin}/source?fullscreen=1`;
  await page.locator('.browser-address').fill(url);
  await page.locator('.browser-address').press('Enter');
  await page.waitForFunction(url => window.uiManager.browserView.state.url === url &&
    !window.uiManager.browserView.state.loading, url);
  await browserEvaluate(application, `(() => {
    const target = document.createElement('div');
    target.id = 'fullscreen-target';
    target.style.cssText = 'height:180px;background:black;color:white';
    const button = document.createElement('button');
    button.id = 'fullscreen-button';
    button.textContent = 'Fullscreen';
    button.addEventListener('click', () => target.requestFullscreen().catch(error => {
      window.fullscreenError = error.message;
    }));
    const probe = document.createElement('button');
    probe.id = 'input-probe';
    probe.textContent = 'Check input';
    window.probeClicks = 0;
    probe.addEventListener('click', () => { window.probeClicks += 1; });
    document.body.prepend(button, probe, target);
    return true;
  })()`);
  await page.evaluate(() => {
    window.fullscreenCaptureBefore = window.uiManager.browserView.input.stream;
    window.fullscreenPreferencesBefore = JSON.stringify({
      inputDeviceId: window.audioPreferences.inputDeviceId,
      useInputWithPlayer: window.audioPreferences.useInputWithPlayer
    });
  });
  const normalBounds = await page.locator('.browser-content').boundingBox();
  const assertLayout = async (fullscreen, nativeFullscreen = fullscreen) => {
    await application.evaluate(async ({ BrowserWindow }, expected) => {
      const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('effetune.html'));
      const contents = globalThis.browserFixture.contents();
      const view = window.contentView.children.find(view => view.webContents === contents);
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline) {
        const htmlFullscreen = await contents.executeJavaScript('Boolean(document.fullscreenElement)');
        const bounds = view.getBounds();
        const size = window.getContentBounds();
        const domBounds = await window.webContents.executeJavaScript(`(() => {
          const { x, y, width, height } = document.querySelector('.browser-content').getBoundingClientRect();
          return { x, y, width, height };
        })()`);
        const targetBounds = expected.fullscreen
          ? { x: 0, y: 0, width: size.width, height: size.height } : domBounds;
        const boundsMatch = Object.entries(targetBounds).every(([key, value]) =>
          bounds[key] === Math.round(value));
        const normalRestored = expected.fullscreen || expected.nativeFullscreen ||
          Object.entries(expected.normalBounds).every(([key, value]) => domBounds[key] === value);
        if (htmlFullscreen === expected.fullscreen && window.isFullScreen() === expected.nativeFullscreen &&
            boundsMatch && normalRestored) return;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      throw new Error(`Fullscreen layout did not settle: ${JSON.stringify({ expected,
        fullscreen: window.isFullScreen(), bounds: view.getBounds(), content: window.getContentBounds(),
        error: await contents.executeJavaScript('window.fullscreenError') })}`);
    }, { fullscreen, nativeFullscreen, normalBounds });
  };
  const clickElement = async id => {
    const point = await browserEvaluate(application, `(() => {
      const rect = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect();
      return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
    })()`);
    await application.evaluate((_electron, point) => {
      const contents = globalThis.browserFixture.contents();
      contents.focus();
      contents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
      contents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
    }, point);
  };
  const enter = async () => {
    await clickElement('fullscreen-button');
    await assertLayout(true);
  };
  const hidePlayer = async (nativeFullscreen = false) => {
    const before = await browserEvaluate(application, 'window.probeClicks');
    // Streaming sites can hide their player without calling exitFullscreen().
    await browserEvaluate(application, "document.getElementById('fullscreen-target').style.display = 'none'");
    await assertLayout(false, nativeFullscreen);
    await clickElement('input-probe');
    assert.equal(await browserEvaluate(application, 'window.probeClicks'), before + 1,
      'page controls accept clicks after the fullscreen player is hidden, without Escape');
    await browserEvaluate(application, "document.getElementById('fullscreen-target').style.display = ''");
  };
  await enter();
  await application.evaluate(() => {
    const contents = globalThis.browserFixture.contents();
    contents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    contents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  });
  await assertLayout(false);
  await enter();
  await browserEvaluate(application, 'document.exitFullscreen()');
  await assertLayout(false);
  await enter();
  await hidePlayer();
  await application.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('effetune.html')).setFullScreen(true);
  });
  await assertLayout(false, true);
  await enter();
  await browserEvaluate(application, 'document.exitFullscreen()');
  await assertLayout(false, true);
  await enter();
  await hidePlayer(true);
  await application.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('effetune.html')).setFullScreen(false);
  });
  await assertLayout(false);
  await enter();
  const navigatedUrl = `${fixture.origin}/source?after-fullscreen=1`;
  await browserEvaluate(application, `(location.href = ${JSON.stringify(navigatedUrl)})`);
  await page.waitForFunction(url => window.uiManager.browserView.state.url === url &&
    !window.uiManager.browserView.state.loading, navigatedUrl);
  await assertLayout(false);
  const restoredBounds = await page.locator('.browser-content').boundingBox();
  assert.deepEqual(restoredBounds, normalBounds, 'the original Browser content rectangle returns');
  const nativeBounds = await application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('effetune.html'));
    return window.contentView.children.find(view => view.webContents === globalThis.browserFixture.contents()).getBounds();
  });
  assert.deepEqual(nativeBounds, Object.fromEntries(Object.entries(normalBounds).map(([key, value]) =>
    [key, Math.round(value)])), 'the native view returns to the Browser content rectangle');
  assert.equal(await page.evaluate(() => {
    const input = window.uiManager.browserView.input;
    return input.stream === window.fullscreenCaptureBefore && input.selected && input.active &&
      input.stream.getAudioTracks().every(track => track.readyState === 'live') &&
      window.fullscreenPreferencesBefore === JSON.stringify({
        inputDeviceId: window.audioPreferences.inputDeviceId,
        useInputWithPlayer: window.audioPreferences.useInputWithPlayer
      });
  }), true, 'fullscreen retains capture, selection, and device/Player mixing preferences');
});

test('Browser startup captures its start page before any user gesture', { timeout: 30_000 }, async t => {
  const profile = await realpath(await mkdtemp(path.join(os.tmpdir(), 'effetune-desktop-browser-')));
  const fixture = await startFixture();
  let application;
  t.after(async () => {
    let shutdownError;
    try { await closeApplication(application); } catch (error) { shutdownError = error; }
    await fixture.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    if (shutdownError) throw shutdownError;
  });
  const startPage = `${fixture.origin}/source?startup=1`;
  await writeFile(path.join(profile, 'config.json'), JSON.stringify({
    onboardingTourShown: true, language: 'en', checkForUpdatesOnStartup: false,
    startupView: 'browser', browser: { bookmarks: [], startPage }
  }));
  await writeFile(path.join(profile, 'audio-preferences.json'), JSON.stringify({
    inputDeviceId: '__effetune_no_audio_input__', sampleRate: 48000, outputDeviceId: 'default'
  }));
  const launched = await launch(profile, fixture.origin);
  application = launched.application;
  const page = launched.page;
  try {
    await page.waitForFunction(url => {
      const view = window.uiManager?.browserView;
      return document.body.classList.contains('view-browser') && view?.input.active &&
        view.input.selected && view.state.url === url && !view.state.loading;
    }, startPage, { timeout: 10_000 });
  } catch (error) {
    const diagnostic = await page.evaluate(async () => ({
      state: await window.electronAPI.browser.getState(),
      inputStatus: window.uiManager?.browserView?.inputStatus,
      selected: window.uiManager?.browserView?.input.selected,
      active: window.uiManager?.browserView?.input.active
    }));
    throw new Error(`Browser startup capture failed: ${JSON.stringify(diagnostic)}`, { cause: error });
  }
  assert.equal(await page.evaluate(() => window.uiManager.browserView.input.stream.getAudioTracks()
    .every(track => track.readyState === 'live')), true);
  const remote = await application.evaluate(() => ({
    url: globalThis.browserFixture.contents().getURL(),
    muted: globalThis.browserFixture.contents().isAudioMuted()
  }));
  assert.deepEqual(remote, { url: startPage, muted: false }, 'startup reservation reached native capture handler');
});

test('Browser Config persists User-Agent and applies it to requests without reloading the current page', { timeout: 45_000 }, async t => {
  const profile = await realpath(await mkdtemp(path.join(os.tmpdir(), 'effetune-browser-user-agent-')));
  const fixture = await startFixture();
  let application;
  t.after(async () => {
    try { await closeApplication(application); }
    finally {
      await fixture.close();
      await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });
  await writeFile(path.join(profile, 'config.json'), JSON.stringify({
    onboardingTourShown: true, language: 'en', checkForUpdatesOnStartup: false, browser: { userAgent: 'EffeTune' }
  }));
  await writeFile(path.join(profile, 'audio-preferences.json'), JSON.stringify({
    inputDeviceId: '__effetune_no_audio_input__', sampleRate: 48000, outputDeviceId: 'default'
  }));
  const launched = await launch(profile, fixture.origin);
  application = launched.application;
  const page = launched.page;
  const url = `${fixture.origin}/user-agent`;
  const defaultUserAgent = (await page.evaluate(() => window.electronAPI.browser.getState())).defaultUserAgent;
  const chromiumVersion = await application.evaluate(() => process.versions.chrome);
  assert.ok(defaultUserAgent.includes(`Chrome/${chromiumVersion}`));
  assert.match(defaultUserAgent, /effetune\//i);
  assert.doesNotMatch(defaultUserAgent, /Electron\//);
  await application.evaluate(({ app, shell, session }) => {
    globalThis.browserTabTest = { requests: [], external: [] };
    shell.openExternal = async url => { globalThis.browserTabTest.external.push(url); };
    app.once('web-contents-created', (_event, contents) => {
      if (contents.session !== session.fromPartition('persist:effetune-browser')) throw new Error('Expected the Browser test partition');
      const setHandler = contents.setWindowOpenHandler.bind(contents);
      contents.setWindowOpenHandler = handler => setHandler(details => {
        const result = handler(details);
        globalThis.browserTabTest.requests.push({ url: details.url, disposition: details.disposition, action: result.action });
        return result;
      });
    });
  });
  await page.evaluate(url => window.electronAPI.browser.navigate(url), url);
  assert.equal(await browserEvaluate(application, 'document.body.textContent'), defaultUserAgent);
  assert.equal(await browserEvaluate(application, 'navigator.userAgent'), defaultUserAgent);
  await browserEvaluate(application, "document.body.dataset.uaProof = 'retained'");
  const before = await page.evaluate(() => window.electronAPI.browser.getState());
  await page.evaluate(() => window.electronIntegration.showConfigDialog());
  await page.locator('#config-category-browser').click();
  const input = page.locator('#browser-user-agent');
  const startPageInput = page.locator('#browser-start-page');
  assert.equal(await input.inputValue(), defaultUserAgent);
  assert.equal(await startPageInput.inputValue(), '');
  await input.fill('Custom Desktop Browser/1.0');
  await input.press('Tab');
  await page.waitForFunction(() => !document.querySelector('#browser-user-agent').disabled &&
    window.appConfig.browser?.userAgent === 'Custom Desktop Browser/1.0');
  const after = await page.evaluate(() => window.electronAPI.browser.getState());
  assert.equal(after.captureGeneration, before.captureGeneration);
  assert.equal(after.captureActive, before.captureActive);
  assert.equal(await browserEvaluate(application, 'document.body.dataset.uaProof'), 'retained');
  assert.equal(await browserEvaluate(application, 'document.body.textContent'), defaultUserAgent);
  assert.equal(await browserEvaluate(application, "fetch('/user-agent').then(response => response.text())"), 'Custom Desktop Browser/1.0');
  assert.equal(JSON.parse(await readFile(path.join(profile, 'config.json'), 'utf8')).browser.userAgent, 'Custom Desktop Browser/1.0');
  await startPageInput.fill(`${fixture.origin}/source?start-page`);
  await startPageInput.press('Tab');
  await page.waitForFunction(url => window.appConfig.browser?.startPage === url, `${fixture.origin}/source?start-page`);
  assert.equal(await browserEvaluate(application, 'document.body.dataset.uaProof'), 'retained');
  await page.locator('#close-btn').click();
  await page.evaluate(() => window.electronIntegration.showConfigDialog());
  assert.equal(await input.inputValue(), 'Custom Desktop Browser/1.0');
  assert.equal(await startPageInput.inputValue(), `${fixture.origin}/source?start-page`);
  await page.locator('#browser-reset-start-page').click();
  await page.waitForFunction(() => window.appConfig.browser?.startPage === '');
  assert.equal(await startPageInput.inputValue(), '');
  assert.equal(JSON.parse(await readFile(path.join(profile, 'config.json'), 'utf8')).browser.startPage, '');
  assert.equal(await browserEvaluate(application, 'document.body.dataset.uaProof'), 'retained');
  await page.locator('#close-btn').click();
  await page.evaluate(url => window.electronAPI.browser.saveSettings({ startPage: url }), url);
  await page.evaluate(() => window.electronIntegration.showConfigDialog());
  assert.equal(await startPageInput.inputValue(), url, 'the existing Use as start page save is reflected in Config');
  await page.locator('#close-btn').click();
  await page.evaluate(() => window.electronAPI.browser.reload());
  await page.waitForFunction(() => !window.uiManager.browserView?.state.loading);
  await application.evaluate(async () => {
    const contents = globalThis.browserFixture.contents();
    if (contents.isLoading()) await new Promise(resolve => contents.once('did-stop-loading', resolve));
  });
  assert.equal(await browserEvaluate(application, 'document.body.textContent'), 'Custom Desktop Browser/1.0');
  await page.evaluate(() => window.electronIntegration.showConfigDialog());
  await page.locator('#browser-reset-user-agent').click();
  await page.waitForFunction(() => window.appConfig.browser?.userAgent === '');
  assert.equal(await input.inputValue(), defaultUserAgent);
  assert.equal(JSON.parse(await readFile(path.join(profile, 'config.json'), 'utf8')).browser.userAgent, '');
  assert.equal(await browserEvaluate(application, "fetch('/user-agent').then(response => response.text())"), defaultUserAgent);
  assert.equal(await browserEvaluate(application, 'document.body.textContent'), 'Custom Desktop Browser/1.0');
  await page.locator('#close-btn').click();
  await page.evaluate(() => window.electronAPI.browser.setPresentation({ visible: true, bounds: { x: 0, y: 100, width: 800, height: 400 } }));
  async function expectOpen(operation, disposition, action) {
    const count = await application.evaluate(() => globalThis.browserTabTest.requests.length);
    await operation();
    const request = await application.evaluate(async (_electron, before) => {
      const deadline = Date.now() + 3000;
      while (globalThis.browserTabTest.requests.length === before && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      return globalThis.browserTabTest.requests[before];
    }, count);
    assert.equal(request?.disposition, disposition);
    assert.equal(request?.action, action);
    return request;
  }
  const target = `${fixture.origin}/source?new-tab`;
  const openAnchor = async (button, modifiers = []) => {
    await browserEvaluate(application, `(() => {
      document.body.innerHTML = '<a target="_blank" style="display:block;width:200px;height:40px">Open fixture</a>';
      document.querySelector('a').href = ${JSON.stringify(target)};
      return true;
    })()`);
    await application.evaluate((_electron, input) => {
      const contents = globalThis.browserFixture.contents();
      contents.focus();
      for (const type of ['mouseDown', 'mouseUp']) contents.sendInputEvent({ type, x: 40, y: 20, clickCount: 1, ...input });
    }, { button, modifiers });
  };
  await expectOpen(() => openAnchor('left'), 'foreground-tab', 'deny');
  await expectOpen(() => openAnchor('left', [process.platform === 'darwin' ? 'meta' : 'control']), 'background-tab', 'deny');
  await expectOpen(() => openAnchor('middle'), 'background-tab', 'deny');
  await expectOpen(() => browserEvaluate(application, `Boolean(window.open(${JSON.stringify(target)}, '_blank'))`), 'foreground-tab', 'deny');
  assert.deepEqual(await application.evaluate(() => globalThis.browserTabTest.external), Array(4).fill(target));
  const openWindow = () => browserEvaluate(application, `Boolean(window.open(${JSON.stringify(target)}, 'fixture-sign-in', 'width=350,height=300'))`);
  await expectOpen(openWindow, 'new-window', 'allow');
  await application.evaluate(({ BrowserWindow, session }) => BrowserWindow.getAllWindows()
    .find(window => window.webContents.session === session.fromPartition('persist:effetune-browser'))?.destroy());
  await page.evaluate(() => window.electronAPI.browser.setPresentation({ visible: false, bounds: { x: 0, y: 100, width: 800, height: 400 } }));
  await page.evaluate(() => window.electronIntegration.showConfigDialog());
  const tabs = page.locator('#browser-open-tabs-externally');
  assert.equal(await tabs.isChecked(), true);
  await tabs.uncheck();
  await page.waitForFunction(() => window.appConfig.browser?.openTabsExternally === false);
  await page.locator('#close-btn').click();
  const saved = JSON.parse(await readFile(path.join(profile, 'config.json'), 'utf8')).browser;
  assert.equal(saved.openTabsExternally, false);
  assert.equal(saved.userAgent, '');
  const currentId = await application.evaluate(() => globalThis.browserFixture.contents().id);
  await expectOpen(() => browserEvaluate(application, `Boolean(window.open(${JSON.stringify(target)}, '_blank'))`), 'foreground-tab', 'deny');
  await application.evaluate(async (_electron, target) => {
    const deadline = Date.now() + 3000;
    while (globalThis.browserFixture.contents().getURL() !== target && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }, target);
  assert.deepEqual(await application.evaluate(() => ({ id: globalThis.browserFixture.contents().id, url: globalThis.browserFixture.contents().getURL() })),
    { id: currentId, url: target }, 'disabling external tabs preserves the captured main WebContents');
  assert.deepEqual(await application.evaluate(() => globalThis.browserTabTest.external), Array(4).fill(target));
});

test('Browser opens HTTP addresses and redirects, saves HTTP pages and captures their audio', { timeout: 45000 }, async t => {
  const profile = await realpath(await mkdtemp(path.join(os.tmpdir(), 'effetune-browser-http-')));
  const fixture = await startFixture({ secure: false });
  let application;
  let page;
  t.after(async () => {
    try {
      if (page && !page.isClosed()) await page.evaluate(() => {
        window.browserTestMeters?.dispose();
        return window.uiManager?.browserView?.input.release();
      });
    } finally {
      try { await closeApplication(application); }
      finally {
        await fixture.close();
        await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      }
    }
  });
  const startPage = `${fixture.origin}/source?start=1`;
  await writeFile(path.join(profile, 'config.json'), JSON.stringify({
    onboardingTourShown: true, language: 'en', checkForUpdatesOnStartup: false,
    browser: { startPage }
  }));
  await writeFile(path.join(profile, 'audio-preferences.json'), JSON.stringify({
    inputDeviceId: '__effetune_no_audio_input__', sampleRate: 48000, outputDeviceId: 'default'
  }));
  ({ application, page } = await launch(profile, fixture.origin));
  await application.evaluate(({ shell }) => {
    globalThis.httpFixtureExternalURLs = [];
    shell.openExternal = async url => { globalThis.httpFixtureExternalURLs.push(url); };
  });
  await page.locator('#browserButton').click();
  await page.waitForFunction(url => window.uiManager.browserView?.input.active &&
    window.uiManager.browserView.state.url === url && !window.uiManager.browserView.state.loading, startPage);
  await page.locator('.browser-address').fill(`${fixture.origin}/redirect`);
  await page.locator('.browser-address').press('Enter');
  const url = `${fixture.origin}/source?redirected=1`;
  await page.waitForFunction(url => window.uiManager.browserView.state.url === url &&
    !window.uiManager.browserView.state.loading, url);
  const bookmarks = [{ name: 'HTTP fixture', url }];
  await page.locator('.browser-toolbar [data-browser-label="bookmarks"]').click();
  const bookmarkDialog = page.locator('.browser-bookmarks');
  await bookmarkDialog.locator('.preset-dialog-name-input').fill('HTTP fixture');
  await bookmarkDialog.locator('[data-browser-label="add"]').click();
  await page.waitForFunction(() => window.uiManager.browserView.state.settings.bookmarks[0]?.name === 'HTTP fixture');
  await bookmarkDialog.locator('[data-browser-label="close"]').click();
  await page.locator('.browser-toolbar [data-browser-label="menu"]').click();
  await page.locator('.browser-menu [data-browser-label="external"]').click();
  await browserEvaluate(application, `Boolean(window.open(${JSON.stringify(url)}, '_blank'))`);
  assert.deepEqual(await application.evaluate(() => globalThis.httpFixtureExternalURLs), [url, url]);
  await page.locator('.browser-toolbar [data-browser-label="menu"]').click();
  await page.locator('.browser-menu [data-browser-label="start"]').click();
  await page.waitForFunction(url => window.uiManager.browserView.state.settings.startPage === url, url);
  const saved = JSON.parse(await readFile(path.join(profile, 'config.json'), 'utf8')).browser;
  assert.equal(saved.startPage, url);
  assert.deepEqual(saved.bookmarks, bookmarks);
  await page.evaluate(() => window.electronIntegration.showConfigDialog());
  assert.equal(await page.locator('#browser-start-page').inputValue(), url);
  await page.locator('#close-btn').click();
  await browserEvaluate(application, 'startFixture()');
  await installMeters(page);
  const levels = await page.evaluate(() => window.browserTestMeters.measure());
  assert.ok(levels.input.every(value => value > 0.001), `HTTP audio reaches both captured input channels: ${JSON.stringify(levels.input)}`);
  assert.equal((await page.evaluate(() => window.electronAPI.browser.getState())).captureActive, true);
});

test('Browser page zoom follows app CSS zoom without moving bounds twice or replacing capture', { timeout: 45000 }, async t => {
  const profile = await realpath(await mkdtemp(path.join(os.tmpdir(), 'effetune-browser-zoom-')));
  const fixture = await startFixture();
  const second = await startFixture({ secure: false });
  let application;
  let page;
  t.after(async () => {
    try {
      if (page && !page.isClosed()) await page.evaluate(() => {
        window.browserTestMeters?.dispose();
        return window.uiManager?.browserView?.input.release();
      });
    } finally {
      try { await closeApplication(application); }
      finally {
        await fixture.close(); await second.close();
        await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      }
    }
  });
  const startPage = `${fixture.origin}/source?zoom=1`;
  await writeFile(path.join(profile, 'config.json'), JSON.stringify({
    onboardingTourShown: true, language: 'en', checkForUpdatesOnStartup: false, browser: { startPage }
  }));
  await writeFile(path.join(profile, 'audio-preferences.json'), JSON.stringify({
    inputDeviceId: '__effetune_no_audio_input__', sampleRate: 48000, outputDeviceId: 'default'
  }));
  ({ application, page } = await launch(profile, fixture.origin));
  await page.evaluate(() => { document.body.style.zoom = '1.2'; });
  await page.locator('#browserButton').click();
  await page.waitForFunction(url => window.uiManager.browserView?.input.active &&
    window.uiManager.browserView.state.url === url && !window.uiManager.browserView.state.loading, startPage);
  const id = await application.evaluate(() => globalThis.browserFixture.contents().id);
  const checkZoom = async expected => {
    const native = await application.evaluate(async ({ webContents, BrowserWindow }, { id, expected }) => {
      const wc = webContents.fromId(id);
      const deadline = Date.now() + 3000;
      while (Math.abs(wc.getZoomFactor() - expected) > 0.000001 && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      const owner = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('effetune.html'));
      const view = owner.contentView.children.find(view => view.webContents === wc);
      return { factor: wc.getZoomFactor(), mode: wc.getZoomMode(), bounds: view.getBounds(),
        content: owner.getContentBounds(), muted: wc.isAudioMuted() };
    }, { id, expected });
    assert.ok(Math.abs(native.factor - expected) < 0.000001);
    assert.equal(native.mode, 'isolated');
    const rect = await page.evaluate(() => {
      const view = window.uiManager.browserView;
      const content = view.content.getBoundingClientRect();
      return { x: content.x, y: content.y, width: content.width, height: content.height,
        rootTop: view.root.getBoundingClientRect().top,
        headerBottom: document.querySelector('.title-container').getBoundingClientRect().bottom };
    });
    assert.ok(Math.abs(rect.rootTop - rect.headerBottom) < 1, JSON.stringify(rect));
    const x = Math.max(0, Math.round(rect.x));
    const y = Math.max(0, Math.round(rect.y));
    assert.deepEqual(native.bounds, { x, y, width: Math.min(native.content.width - x, Math.round(rect.width)),
      height: Math.min(native.content.height - y, Math.round(rect.height)) });
    assert.equal(native.muted, false);
  };
  await checkZoom(1.2);
  await browserEvaluate(application, "(document.body.dataset.zoomProof='retained', startFixture())");
  await installMeters(page);
  await page.evaluate(() => {
    window.zoomTestCapture = window.uiManager.browserView.input.stream;
    window.zoomTestGeneration = window.uiManager.browserView.state.captureGeneration;
  });
  await application.evaluate(({ Menu }) => { Menu.getApplicationMenu().getMenuItemById('view.zoomIn').click(); });
  await checkZoom(1.3);
  assert.equal(await browserEvaluate(application, 'document.body.dataset.zoomProof'), 'retained');
  await page.evaluate(() => { window.uiManager.browserView.hide(); document.body.style.zoom = '1.5'; });
  await page.evaluate(() => window.uiManager.browserView.show());
  await checkZoom(1.5);
  const levels = await page.evaluate(() => window.browserTestMeters.measure());
  assert.ok(levels.input.every(value => value > 0.001), JSON.stringify(levels.input));
  await page.evaluate(url => window.electronAPI.browser.navigate(url), `${second.origin}/source?cross-origin=1`);
  await checkZoom(1.5);
  await page.evaluate(() => window.electronAPI.browser.back());
  await page.waitForFunction(url => window.uiManager.browserView.state.url === url &&
    !window.uiManager.browserView.state.loading, startPage);
  await checkZoom(1.5);
  await browserEvaluate(application, `Boolean(window.open(${JSON.stringify(`${fixture.origin}/source?zoom-popup=1`)}, 'zoom-popup', 'width=350,height=300'))`);
  await application.evaluate(({ Menu }) => { Menu.getApplicationMenu().getMenuItemById('view.resetZoom').click(); });
  await checkZoom(1);
  const popup = await application.evaluate(({ BrowserWindow }) => {
    const child = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('zoom-popup=1'));
    return { mode: child.webContents.getZoomMode(), factor: child.webContents.getZoomFactor() };
  });
  assert.deepEqual(popup, { mode: 'isolated', factor: 1 });
  assert.equal(await page.evaluate(() => {
    const view = window.uiManager.browserView;
    return view.input.stream === window.zoomTestCapture && view.state.captureGeneration === window.zoomTestGeneration &&
      view.input.stream.getAudioTracks().every(track => track.readyState === 'live') && view.input.active;
  }), true);
});
