import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { startIsolatedStaticServer, stopIsolatedStaticServer } from './run-power-browser-smoke.mjs';

const modulePath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(modulePath), '..');
const extensionPath = path.join(repoRoot, 'out', 'extension');
const fixturePath = '/tests/browser/browser-extension-audio.fixture.html';
const testTimeoutMs = 300_000;
const transitionTimeoutMs = 20_000;

function withTimeout(promise, timeoutMs, message) {
  let timeoutId;
  const timeout = new Promise((resolve, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

async function runNamedPhase(name, timeoutMs, operation) {
  process.stdout.write(`[extension smoke] ${name} started.\n`);
  const result = await withTimeout(
    Promise.resolve().then(operation), timeoutMs, `[extension smoke] ${name} timed out after ${timeoutMs} ms.`
  );
  process.stdout.write(`[extension smoke] ${name} passed.\n`);
  return result;
}

function createImpulseWav(amplitude) {
  const sampleRate = 48000;
  const frames = 4096;
  const bytes = Buffer.alloc(44 + frames * 2);
  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(frames * 2, 40);
  bytes.writeInt16LE(Math.round(32767 * amplitude), 44);
  return bytes;
}

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch (error) {
    if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error;
    throw new Error('Playwright is required. Install dependencies and the Chromium browser before retrying.', {
      cause: error
    });
  }
}

async function validateDistribution() {
  const manifestPath = path.join(extensionPath, 'manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.minimum_chrome_version, '116');
  assert.deepEqual([...manifest.permissions].sort(), ['activeTab', 'offscreen', 'storage', 'tabCapture']);
  assert.equal(manifest.host_permissions, undefined);
  assert.equal(manifest.content_scripts, undefined);
  assert.equal(
    manifest.content_security_policy?.extension_pages,
    "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"
  );
  assert.equal(manifest.background?.type, 'module');
  assert.equal(manifest.background?.service_worker, 'extension/service-worker.js');
  assert.equal(manifest.action?.default_popup, 'extension/popup.html');
  await Promise.all([
    fs.access(path.join(extensionPath, 'extension', 'offscreen.html')),
    fs.access(path.join(extensionPath, 'extension', 'popup.html')),
    fs.access(path.join(extensionPath, 'extension', 'editor.html')),
    fs.access(path.join(extensionPath, 'plugins', 'audio-processor.js')),
    fs.access(path.join(extensionPath, 'plugins', 'dsp', 'effetune-dsp.wasm')),
    fs.access(path.join(extensionPath, 'plugins', 'dsp', 'effetune-dsp.simd.wasm'))
  ]);
  return manifest;
}

async function extensionRequest(page, command, args = {}) {
  return page.evaluate(async ({ commandValue, argsValue }) => {
    const response = await chrome.runtime.sendMessage({
      destination: 'worker',
      command: commandValue,
      args: argsValue
    });
    if (!response?.ok) throw new Error(response?.error || 'Extension request failed');
    return response.result;
  }, { commandValue: command, argsValue: args });
}

async function modelRequest(page, command, args = {}) {
  return page.evaluate(async ({ commandValue, argsValue }) => {
    const { ExtensionClient } = await import(chrome.runtime.getURL('extension/protocol.js'));
    const client = new ExtensionClient();
    try {
      await client.connect();
      return await client.request(commandValue, argsValue);
    } finally {
      client.close();
    }
  }, { commandValue: command, argsValue: args });
}

async function waitForState(page, predicate, description, timeoutMs = transitionTimeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let state = null;
  do {
    state = await extensionRequest(page, 'getState');
    if ((!predicate.status || state.status === predicate.status) &&
        (!predicate.powerState || state.powerState === predicate.powerState) &&
        (!predicate.tabId || state.target?.tabId === predicate.tabId)) return state;
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  throw new Error(`${description} Last state: ${JSON.stringify(state)}`);
}

async function waitForImportedIr(page, previousIr, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  do {
    const state = await extensionRequest(page, 'getState');
    const ir = state.plugins.find(plugin => plugin.nm === 'IR Reverb')?.ir;
    if (typeof ir === 'string' && ir.length === 24 && ir !== previousIr) return ir;
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  throw new Error('The imported impulse response did not reach the extension model.');
}

async function waitForSettledIr(page, expectedIr, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  do {
    const [state, visible] = await Promise.all([
      extensionRequest(page, 'getState'),
      page.evaluate(() => ({
        ir: window.audioManager?.pipeline?.find(item => item.name === 'IR Reverb')?.ir,
        pendingMutations: window.audioManager?.pendingMutations
      }))
    ]);
    const remoteIr = state.plugins.find(plugin => plugin.nm === 'IR Reverb')?.ir;
    if (remoteIr === expectedIr && visible.ir === expectedIr && visible.pendingMutations === 0) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  throw new Error('The imported impulse response did not settle in both editor and extension state.');
}

async function waitForOffscreenPowerState(runtime, expectedState, description, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  do {
    const snapshot = JSON.parse(await runtime.evaluate(
      'JSON.stringify(window.audioManager?.getPowerSnapshot?.() || null)'
    ));
    if (snapshot?.effectiveState === expectedState) return snapshot;
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  throw new Error(description);
}

async function waitForPowerControllerSettled(runtime, description, timeoutMs = transitionTimeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let diagnostics;
  do {
    diagnostics = JSON.parse(await runtime.evaluate(`JSON.stringify((() => {
      const controller = window.audioManager?.powerPolicyController;
      return {
        snapshot: controller?.getSnapshot?.(),
        pendingCommand: controller?.pendingCommand,
        workletAck: controller?.workletAck,
        skipEpoch: controller?.skipEpoch,
        firstRenderWaiters: controller?.firstRenderWaiters?.size
      };
    })())`));
    if (diagnostics.snapshot?.transition?.state === 'stable' && !diagnostics.pendingCommand &&
        diagnostics.firstRenderWaiters === 0) return diagnostics;
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  throw new Error(`${description} Last diagnostics: ${JSON.stringify(diagnostics)}`);
}

async function assertCaptureReleased(page, offscreenRuntime, sourcePage, expectedStatus,
  pipelineFingerprint) {
  const state = await waitForState(
    page,
    { status: expectedStatus },
    `The failed start did not settle in ${expectedStatus} state.`
  );
  assert.equal(state.target, null);
  assert.equal(JSON.stringify(state.plugins), pipelineFingerprint);
  assert.equal((await page.evaluate(() => chrome.tabCapture.getCapturedTabs()))
    .some(item => item.status === 'active' || item.status === 'pending'), false);
  const resources = JSON.parse(await offscreenRuntime.evaluate(`JSON.stringify({
    context: window.audioManager?.audioContext || null,
    stream: window.audioManager?.stream || null
  })`));
  assert.equal(resources.context, null);
  assert.equal(resources.stream, null);
  assert.equal((await sourcePage.evaluate(() => window.__browserExtensionAudio.snapshot())).state,
    'running');
  assert.ok(await sourcePage.evaluate(() => window.__browserExtensionAudio.measureRms()) > 0.05,
    'The source tab did not return to normal playback after a failed start.');
  return state;
}

async function findTarget(cdp, predicate, description) {
  const deadline = Date.now() + transitionTimeoutMs;
  do {
    const { targetInfos } = await cdp.send('Target.getTargets', { filter: [{}] });
    const target = targetInfos.find(predicate);
    if (target) return target;
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  throw new Error(`Timed out waiting for ${description}.`);
}

async function waitForTargetGone(cdp, targetId, description) {
  const deadline = Date.now() + transitionTimeoutMs;
  do {
    const { targetInfos } = await cdp.send('Target.getTargets', { filter: [{}] });
    if (!targetInfos.some(target => target.targetId === targetId)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  throw new Error(`Timed out waiting for ${description}.`);
}

async function connectBrowserCdp(profilePath) {
  const activePortPath = path.join(profilePath, 'DevToolsActivePort');
  const deadline = Date.now() + transitionTimeoutMs;
  let lines;
  do {
    try {
      lines = (await fs.readFile(activePortPath, 'utf8')).trim().split(/\r?\n/);
      if (lines.length >= 2) break;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 25));
  } while (Date.now() < deadline);
  if (!lines || lines.length < 2) throw new Error('Chromium did not expose its test-only CDP endpoint.');

  const socket = new WebSocket(`ws://127.0.0.1:${lines[0]}${lines[1]}`);
  await withTimeout(new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(new Error('Could not connect to Chromium CDP.')), { once: true });
  }), transitionTimeoutMs, 'Timed out connecting to Chromium CDP.');

  return createRawCdpConnection(socket);
}

function createRawCdpConnection(socket) {
  let nextId = 0;
  let closed = false;
  const pending = new Map();
  const listeners = new Set();
  const disconnect = error => {
    if (closed) return;
    closed = true;
    for (const request of pending.values()) request.reject(error);
    pending.clear();
    listeners.clear();
  };
  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data));
    if (message.id) {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
      return;
    }
    for (const listener of listeners) listener(message);
  });
  socket.addEventListener('close', () => disconnect(new Error('CDP connection closed')));
  socket.addEventListener('error', () => disconnect(new Error('CDP connection failed')));
  return {
    onMessage(listener) {
      if (!closed) listeners.add(listener);
      return () => listeners.delete(listener);
    },
    send(method, params = {}, sessionId = null) {
      if (closed) return Promise.reject(new Error('CDP connection closed'));
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        try {
          socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
        } catch (error) {
          pending.delete(id);
          reject(error);
        }
      });
    },
    close() {
      if (closed) return;
      disconnect(new Error('CDP connection closed'));
      if (socket.readyState < 2) socket.close();
    }
  };
}

async function createAttachedRuntime(connection, target, sessionId) {
  const logs = [];
  const exceptions = [];
  const consoleErrors = [];
  const stopListening = connection.onMessage(message => {
    if (message.sessionId !== sessionId) return;
    if (message.method === 'Runtime.consoleAPICalled') {
      const value = message.params.args.map(argument =>
        argument.value ?? argument.description ?? argument.unserializableValue ?? '').join(' ');
      logs.push(value);
      if (message.params.type === 'error') consoleErrors.push(value);
    }
    if (message.method === 'Runtime.exceptionThrown') {
      const value = message.params.exceptionDetails?.exception?.description ||
        message.params.exceptionDetails?.text || 'Uncaught exception';
      logs.push(value);
      exceptions.push(value);
    }
  });
  await withTimeout(
    connection.send('Runtime.enable', {}, sessionId), transitionTimeoutMs,
    `Timed out initializing Runtime for ${target.url || target.targetId}.`
  );
  let detached = false;
  return {
    target,
    logs,
    exceptions,
    consoleErrors,
    async evaluate(expression) {
      const response = await connection.send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true
      }, sessionId);
      if (response.exceptionDetails) {
        throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
      }
      return response.result?.value;
    },
    async detach() {
      if (detached) return;
      detached = true;
      stopListening();
      await connection.send('Target.detachFromTarget', { sessionId }).catch(() => {});
    }
  };
}

async function attachExistingRuntime(connection, target) {
  const { sessionId } = await connection.send('Target.attachToTarget', {
    targetId: target.targetId,
    flatten: true
  });
  return createAttachedRuntime(connection, target, sessionId);
}

function collectPageErrors(context, externalRequests) {
  const errors = [];
  const attach = page => {
    page.on('pageerror', error => errors.push(`${page.url()}: ${error.message}`));
    page.on('console', message => {
      if (message.type() === 'error') errors.push(`${page.url()}: ${message.text()}`);
    });
  };
  context.on('request', request => {
    const url = request.url();
    if (!/^(https?|wss?):/i.test(url)) return;
    let initiatorUrl = request.serviceWorker()?.url() || '';
    try {
      initiatorUrl ||= request.frame().url();
    } catch {
      // Browser-level requests do not always have a frame.
    }
    if (initiatorUrl.startsWith('chrome-extension://')) externalRequests.push(url);
  });
  context.pages().forEach(attach);
  context.on('page', attach);
  return errors;
}

function consumeExpectedPageError(errors, expected) {
  const matches = errors.flatMap((value, index) => value === expected ? [index] : []);
  assert.equal(matches.length, 1, `Expected one matching fault diagnostic: ${expected}`);
  errors.splice(matches[0], 1);
}

export async function waitAndConsumeExpectedRuntimeConsoleError(
  runtime, exactMatcher, description, timeoutMs = 5_000
) {
  assert.ok(timeoutMs > 0 && timeoutMs <= 5_000, 'Console error wait must be between 1 and 5000 ms.');
  const deadline = Date.now() + timeoutMs;
  do {
    const matches = runtime.consoleErrors.flatMap((value, index) =>
      exactMatcher(value) ? [index] : []
    );
    assert.ok(matches.length <= 1,
      `Expected one ${description} console error, received ${matches.length} exact matches.`);
    if (matches.length === 1) {
      runtime.consoleErrors.splice(matches[0], 1);
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 20));
  } while (Date.now() < deadline);
  const compact = runtime.consoleErrors.slice(0, 8).map(value =>
    value.length > 240 ? `${value.slice(0, 240)}…` : value
  );
  throw new Error(
    `Timed out waiting for ${description} console error. Current errors: ${JSON.stringify(compact)}`
  );
}

function exactConsoleDiagnostic(firstLine) {
  return value => {
    const lines = value.replaceAll('\r\n', '\n').split('\n');
    return lines[0] === firstLine &&
      (lines.length === 1 || lines.slice(1).every(line => /^\s+at\s+\S/.test(line)));
  };
}

export function matchesExactEvaluationError(error, expectedMessage) {
  const prefix = 'page.evaluate: Error: ';
  const message = typeof error?.message === 'string' ? error.message : '';
  if (message === expectedMessage) return true;
  if (!message.startsWith(prefix)) return false;
  const lines = message.slice(prefix.length).replaceAll('\r\n', '\n').split('\n');
  return lines[0] === expectedMessage && lines.length > 1 &&
    lines.slice(1).every(line => /^\s+at\s+\S/.test(line));
}

async function runBrowserScenario({ chromium, baseURL, profilePath, onContext }) {
  const launchOptions = {
    headless: process.env.EXTENSION_BROWSER_HEADLESS === '1',
    args: [
      '--autoplay-policy=no-user-gesture-required',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--enable-unsafe-extension-debugging',
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--remote-debugging-port=0'
    ]
  };
  const context = await runNamedPhase('official extension launch', 60_000, () =>
    chromium.launchPersistentContext(profilePath, launchOptions)
  );
  onContext(context);
  const externalRequests = [];
  const errors = collectPageErrors(context, externalRequests);
  let cdp;
  let browserCdp;
  let offscreenRuntime;
  let workerRuntime;
  try {
    const browserVersion = context.browser()?.version() || '';
    assert.ok(Number.parseInt(browserVersion, 10) >= 116, `Unexpected browser version: ${browserVersion}`);
    let extensionId;
    await runNamedPhase('extension service worker ready', 60_000, async () => {
      const deadline = Date.now() + 60_000;
      let worker;
      do {
        worker = context.serviceWorkers().find(candidate =>
          /^chrome-extension:\/\/[a-p]{32}\/extension\/service-worker\.js$/.test(candidate.url())
        );
        if (worker) break;
        await new Promise(resolve => setTimeout(resolve, 50));
      } while (Date.now() < deadline);
      assert.ok(worker, 'The bundled Chromium extension service worker did not start.');
      const match = worker.url().match(
        /^chrome-extension:\/\/([a-p]{32})\/extension\/service-worker\.js$/
      );
      assert.ok(match, `Unexpected extension service worker URL: ${worker.url()}`);
      extensionId = match[1];
    });
    const sourcePage = context.pages()[0] || await context.newPage();
    await runNamedPhase('fixture ready', 60_000, async () => {
      await sourcePage.goto(`${baseURL}${fixturePath}`, { waitUntil: 'load' });
      await sourcePage.click('#startAudio');
      assert.deepEqual(await sourcePage.evaluate(() => window.__browserExtensionAudio.snapshot()), {
        ready: true,
        state: 'running',
        sampleRate: 48000,
        frequency: 997
      });
      assert.ok(await sourcePage.evaluate(() => window.__browserExtensionAudio.measureRms()) > 0.05,
        'The fixture source did not produce a measurable audio signal.');
    });

    const browser = context.browser();
    assert.ok(browser, 'The persistent browser connection is unavailable.');

    let controlPage;
    let initialState;
    await runNamedPhase('editor connection and extension runtime attachment', 60_000, async () => {
      controlPage = await context.newPage();
      await controlPage.goto(`chrome-extension://${extensionId}/extension/editor.html`, {
        waitUntil: 'load'
      });
      await controlPage.waitForSelector('#editorStatus', { timeout: transitionTimeoutMs });
      initialState = await extensionRequest(controlPage, 'getState');
      cdp = await browser.newBrowserCDPSession();
      browserCdp = await connectBrowserCdp(profilePath);
      const [workerTarget, offscreenTarget] = await Promise.all([
        findTarget(
          cdp,
          target => target.type === 'service_worker' &&
            target.url === `chrome-extension://${extensionId}/extension/service-worker.js`,
          'the extension service worker target'
        ),
        findTarget(
          cdp,
          target => target.url === `chrome-extension://${extensionId}/extension/offscreen.html`,
          'the extension offscreen document target'
        )
      ]);
      [workerRuntime, offscreenRuntime] = await Promise.all([
        attachExistingRuntime(browserCdp, workerTarget),
        attachExistingRuntime(browserCdp, offscreenTarget)
      ]);
    });
    await sourcePage.bringToFront();
    await runNamedPhase('activeTab permission grant', 30_000, async () => {
      const { targetInfos: beforeTargets } = await cdp.send('Target.getTargets', { filter: [{}] });
      const sourceTarget = beforeTargets.find(target =>
        target.type === 'tab' && target.url === sourcePage.url()
      );
      assert.ok(sourceTarget, `The fixture source target was not found for ${sourcePage.url()}.`);
      const beforeIds = new Set(beforeTargets.map(target => target.targetId));
      let actionSettled = false;
      const action = browserCdp.send('Extensions.triggerAction', {
        id: extensionId,
        targetId: sourceTarget.targetId
      }).finally(() => { actionSettled = true; });
      action.catch(() => {});
      const popupUrl = `chrome-extension://${extensionId}/extension/popup.html`;
      while (true) {
        if (actionSettled) break;
        const { targetInfos } = await cdp.send('Target.getTargets', { filter: [{}] });
        const popupTarget = targetInfos.find(target => !beforeIds.has(target.targetId) &&
          target.type === 'other' && target.url === popupUrl);
        if (popupTarget) {
          await cdp.send('Target.closeTarget', { targetId: popupTarget.targetId });
          break;
        }
        await Promise.race([
          action.catch(() => {}),
          new Promise(resolve => setTimeout(resolve, 50))
        ]);
      }
      await action;
    });
    const sourceTabs = await controlPage.evaluate(async () => {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      return tabs.map(tab => ({ id: tab.id, url: tab.url }));
    });
    assert.equal(
      sourceTabs.length,
      1,
      `Expected exactly one active tab after the activeTab grant, found ${sourceTabs.length}.`
    );
    const sourceTabId = sourceTabs[0].id;
    assert.ok(Number.isInteger(sourceTabId), 'The fixture source tab does not have a valid tab ID.');
    assert.equal(sourceTabs[0].url, sourcePage.url(), 'The activeTab grant targeted the wrong tab.');
    const initialPipelineFingerprint = JSON.stringify(initialState.plugins);

    await runNamedPhase('injected capture refusal cleanup', 60_000, async () => {
      assert.equal(await workerRuntime.evaluate(`(() => {
      globalThis.__extensionSmokeOriginalGetMediaStreamId = chrome.tabCapture.getMediaStreamId;
      globalThis.__extensionSmokeCaptureFailures = 0;
      chrome.tabCapture.getMediaStreamId = async () => {
        globalThis.__extensionSmokeCaptureFailures += 1;
        throw new DOMException('Injected capture refusal', 'NotAllowedError');
      };
      return chrome.tabCapture.getMediaStreamId !== globalThis.__extensionSmokeOriginalGetMediaStreamId;
      })()`), true);
      try {
        await assert.rejects(
          extensionRequest(controlPage, 'start', { tabId: sourceTabId }),
          error => /Tab audio could not be started/.test(error.message)
        );
        await assertCaptureReleased(
          controlPage, offscreenRuntime, sourcePage, 'stopped', initialPipelineFingerprint
        );
      } finally {
        assert.equal(await workerRuntime.evaluate(`(() => {
          chrome.tabCapture.getMediaStreamId = globalThis.__extensionSmokeOriginalGetMediaStreamId;
          const failures = globalThis.__extensionSmokeCaptureFailures;
          delete globalThis.__extensionSmokeOriginalGetMediaStreamId;
          delete globalThis.__extensionSmokeCaptureFailures;
          return failures;
        })()`), 1);
      }
      await waitAndConsumeExpectedRuntimeConsoleError(
        workerRuntime,
        exactConsoleDiagnostic('Tab audio action failed: NotAllowedError: Injected capture refusal'),
        'capture refusal'
      );
    });

    await runNamedPhase('injected WASM startup failure cleanup', 60_000, async () => {
      assert.equal(await offscreenRuntime.evaluate(`(() => {
      globalThis.__extensionSmokeOriginalFetch = globalThis.fetch;
      globalThis.__extensionSmokeWasmFailures = 0;
      globalThis.fetch = (...args) => {
        const url = String(args[0]?.url || args[0] || '');
        const resourceUrl = url.split('#', 1)[0].split('?', 1)[0];
        if (resourceUrl.includes('/plugins/dsp/effetune-dsp') && resourceUrl.endsWith('.wasm')) {
          globalThis.__extensionSmokeWasmFailures += 1;
          return Promise.reject(new TypeError('Injected WASM fetch failure'));
        }
        return globalThis.__extensionSmokeOriginalFetch(...args);
      };
      return globalThis.fetch !== globalThis.__extensionSmokeOriginalFetch;
      })()`), true);
      try {
        const wasmFailure = await extensionRequest(controlPage, 'start', { tabId: sourceTabId });
        assert.equal(wasmFailure.status, 'error');
        assert.match(wasmFailure.error, /website is playing normally/i);
        await assertCaptureReleased(
          controlPage, offscreenRuntime, sourcePage, 'error', initialPipelineFingerprint
        );
        consumeExpectedPageError(
          errors,
          `${controlPage.url()}: [EffeTune extension] Tab audio could not be processed. ` +
            'The website is playing normally. Start EffeTune again to retry.'
        );
      } finally {
        assert.ok(await offscreenRuntime.evaluate(`(() => {
          globalThis.fetch = globalThis.__extensionSmokeOriginalFetch;
          const failures = globalThis.__extensionSmokeWasmFailures;
          delete globalThis.__extensionSmokeOriginalFetch;
          delete globalThis.__extensionSmokeWasmFailures;
          return failures;
        })()`) >= 1);
      }
      await waitAndConsumeExpectedRuntimeConsoleError(
        offscreenRuntime,
        exactConsoleDiagnostic(
          'Capture startup failed: Error: The captured stream requires a ready WASM engine'
        ),
        'WASM startup failure'
      );
    });

    await runNamedPhase('injected AudioWorklet startup failure cleanup', 60_000, async () => {
      assert.equal(await offscreenRuntime.evaluate(`(() => {
      globalThis.__extensionSmokeOriginalAudioWorkletNode = globalThis.AudioWorkletNode;
      globalThis.__extensionSmokeWorkletFailures = 0;
      globalThis.AudioWorkletNode = new Proxy(globalThis.AudioWorkletNode, {
        construct() {
          globalThis.__extensionSmokeWorkletFailures += 1;
          throw new DOMException('Injected AudioWorkletNode failure', 'NotSupportedError');
        }
      });
      return globalThis.AudioWorkletNode !== globalThis.__extensionSmokeOriginalAudioWorkletNode;
      })()`), true);
      try {
        const workletFailure = await extensionRequest(controlPage, 'start', { tabId: sourceTabId });
        assert.equal(workletFailure.status, 'error');
        assert.match(workletFailure.error, /website is playing normally/i);
        await assertCaptureReleased(
          controlPage, offscreenRuntime, sourcePage, 'error', initialPipelineFingerprint
        );
        consumeExpectedPageError(
          errors,
          `${controlPage.url()}: [EffeTune extension] Tab audio could not be processed. ` +
            'The website is playing normally. Start EffeTune again to retry.'
        );
      } finally {
        assert.ok(await offscreenRuntime.evaluate(`(() => {
          globalThis.AudioWorkletNode = globalThis.__extensionSmokeOriginalAudioWorkletNode;
          const failures = globalThis.__extensionSmokeWorkletFailures;
          delete globalThis.__extensionSmokeOriginalAudioWorkletNode;
          delete globalThis.__extensionSmokeWorkletFailures;
          return failures;
        })()`) >= 1);
      }
      await waitAndConsumeExpectedRuntimeConsoleError(
        offscreenRuntime,
        exactConsoleDiagnostic(
          'Capture startup failed: Error: Audio Error: Injected AudioWorkletNode failure'
        ),
        'AudioWorkletNode startup failure'
      );
      await waitAndConsumeExpectedRuntimeConsoleError(
        offscreenRuntime,
        exactConsoleDiagnostic(
          'Failed to load audio worklet: NotSupportedError: Injected AudioWorkletNode failure'
        ),
        'AudioWorkletNode load failure'
      );
      const faultCloseDiagnostics = JSON.parse(await offscreenRuntime.evaluate(`JSON.stringify({
        unexpectedCloseLogs: null,
        audioContextCreatedLogs: null,
        resetInProgress: Boolean(window.audioManager?._resetInProgress),
        context: window.audioManager?.audioContext || null,
        stream: window.audioManager?.stream || null
      })`));
      faultCloseDiagnostics.unexpectedCloseLogs = offscreenRuntime.logs.filter(message =>
        message.includes('[AudioContext] closed unexpectedly')).length;
      faultCloseDiagnostics.audioContextCreatedLogs = offscreenRuntime.logs.filter(message =>
        message.includes('AudioContext created with options:')).length;
      assert.equal(faultCloseDiagnostics.context, null);
      assert.equal(faultCloseDiagnostics.stream, null);
      assert.equal(faultCloseDiagnostics.resetInProgress, false);
      if (faultCloseDiagnostics.unexpectedCloseLogs > 0) {
        throw new Error(`Intentional failure cleanup triggered unexpected AudioContext recovery: ` +
          `${JSON.stringify(faultCloseDiagnostics)}`);
      }
    });
    process.stdout.write('Capture refusal, WASM failure, and Worklet failure cleanup passed.\n');

    await extensionRequest(controlPage, 'start', { tabId: sourceTabId });
    const processing = await waitForState(controlPage, {
      status: 'processing', tabId: sourceTabId
    }, 'The extension did not enter processing state.');
    assert.equal(processing.target.title, 'EffeTune browser extension audio smoke');
    assert.equal(processing.sampleRate, 48000);

    const captured = await controlPage.evaluate(() => chrome.tabCapture.getCapturedTabs());
    assert.ok(captured.some(item => item.tabId === sourceTabId && item.status === 'active'));
    const contexts = await controlPage.evaluate(() => chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT']
    }));
    assert.equal(contexts.length, 1);
    assert.ok(contexts[0].documentUrl.endsWith('/extension/offscreen.html'));
    process.stdout.write('Extension capture and WASM startup passed.\n');

    const editor = await context.newPage();
    await editor.goto(`chrome-extension://${extensionId}/extension/editor.html`, { waitUntil: 'load' });
    await editor.waitForSelector('#editorStatus:text-is("Processing")', { timeout: transitionTimeoutMs });
    const representativePipeline = [
      { nm: 'Section', en: true, cm: 'Browser smoke', ib: 0, ob: 0, ch: 'A' },
      { nm: 'Volume', en: true, vl: -18, ib: 0, ob: 0, ch: 'A' },
      { nm: '5Band PEQ', en: true, ib: 0, ob: 0, ch: 'A' },
      { nm: 'Compressor', en: true, ib: 0, ob: 0, ch: 'A' },
      { nm: 'Dattorro Plate Reverb', en: true, ib: 0, ob: 0, ch: 'A' },
      { nm: 'Level Meter', en: true, ib: 0, ob: 0, ch: 'A' }
    ];
    try {
      await modelRequest(editor, 'setPipeline', { plugins: representativePipeline });
    } catch (error) {
      const diagnostics = await offscreenRuntime.evaluate(`JSON.stringify({
        dsp: window.audioManager?.getDspExecutionStateSnapshot?.(),
        power: window.audioManager?.getPowerSnapshot?.(),
        pipeline: window.audioManager?.pipeline?.map(plugin => ({ id: plugin.id, name: plugin.name }))
      })`).catch(diagnosticError => `diagnostic failed: ${diagnosticError.message}`);
      throw new Error(`${error.message}\nOffscreen console: ${offscreenRuntime.logs.join(' | ')}\nDiagnostics: ${diagnostics}`, {
        cause: error
      });
    }
    const volumeInput = editor.locator('input[id$="-Volume-volume-value"]').first();
    await volumeInput.waitFor({ state: 'visible', timeout: transitionTimeoutMs });
    await volumeInput.evaluate(input => {
      for (const value of ['-17', '-16']) {
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    await editor.waitForTimeout(1000);
    assert.equal(await volumeInput.inputValue(), '-16');
    assert.equal((await extensionRequest(editor, 'getState')).plugins
      .find(plugin => plugin.nm === 'Volume')?.vl, -16);

    for (const enabled of [false, true]) {
      const current = (await extensionRequest(editor, 'getState')).plugins;
      await modelRequest(editor, 'setPipeline', {
        plugins: current.map(plugin => plugin.nm === 'Section' ? { ...plugin, en: enabled } : plugin)
      });
      const sectionState = await extensionRequest(editor, 'getState');
      assert.equal(sectionState.status, 'processing');
      assert.equal(sectionState.plugins.find(plugin => plugin.nm === 'Section')?.en, enabled);
      assert.equal((await editor.evaluate(() => chrome.tabCapture.getCapturedTabs()))
        .find(item => item.tabId === sourceTabId)?.status, 'active');
    }
    await modelRequest(editor, 'savePreset', { name: 'Browser smoke' });
    await editor.waitForFunction(() => {
      const meter = window.audioManager?.pipeline?.find(plugin => plugin.name === 'Level Meter');
      return Array.isArray(meter?.lv) && meter.lv.some(level => level > -100);
    }, null, { timeout: transitionTimeoutMs });
    const editorSnapshot = await extensionRequest(editor, 'getState');
    assert.deepEqual(editorSnapshot.plugins.map(plugin => plugin.nm),
      representativePipeline.map(plugin => plugin.nm));
    assert.ok(Object.hasOwn(editorSnapshot.presets, 'Browser smoke'));
    process.stdout.write('Representative DSP pipeline and telemetry passed.\n');
    await extensionRequest(editor, 'setBypass', { enabled: true });
    assert.equal((await extensionRequest(editor, 'getState')).masterBypass, true);
    assert.equal((await editor.evaluate(() => chrome.tabCapture.getCapturedTabs()))
      .find(item => item.tabId === sourceTabId)?.status, 'active');
    await extensionRequest(editor, 'setBypass', { enabled: false });

    const generatedAssetPipeline = [
      { nm: 'FIR Crossover', en: true, ib: 0, ob: 0, ch: 'A' },
      { nm: 'Level Meter', en: true, ib: 0, ob: 0, ch: 'A' }
    ];
    await modelRequest(editor, 'setPipeline', { plugins: generatedAssetPipeline });
    const assetState = await extensionRequest(editor, 'getState');
    assert.deepEqual(assetState.plugins.map(plugin => plugin.nm), ['FIR Crossover', 'Level Meter']);
    const assetDiagnostics = JSON.parse(await offscreenRuntime.evaluate(`JSON.stringify({
      pipeline: window.audioManager?.pipeline?.map(plugin => ({ id: plugin.id, name: plugin.name })),
      dsp: window.audioManager?.getDspExecutionStateSnapshot?.()
    })`));
    assert.deepEqual(assetDiagnostics.pipeline.map(plugin => plugin.name), ['FIR Crossover', 'Level Meter']);
    assert.ok(assetDiagnostics.dsp.states.length >= 2);
    assert.ok(assetDiagnostics.dsp.states.every(item => item.state === 'active'));

    const assetPipelineFingerprint = JSON.stringify(assetState.plugins);
    await assert.rejects(
      modelRequest(editor, 'setPipeline', { plugins: [
        { nm: 'Volume', en: true, vl: -6, ib: 1, ob: 0, ch: 'A' }
      ] }),
      error => matchesExactEvaluationError(
        error,
        'These settings could not be applied. Check the effects, channels and impulse response files. Your previous pipeline has been kept.'
      )
    );
    await waitAndConsumeExpectedRuntimeConsoleError(
      offscreenRuntime,
      exactConsoleDiagnostic(
        'Editor update failed: Error: This preset uses audio buses. ' +
          'The extension supports one serial stereo pipeline.'
      ),
      'invalid topology rejection'
    );
    assert.equal(JSON.stringify((await extensionRequest(editor, 'getState')).plugins),
      assetPipelineFingerprint);
    process.stdout.write('Generated assets and preset rejection passed.\n');

    await modelRequest(editor, 'setPipeline', { plugins: [
      { nm: 'IR Reverb', en: true, ib: 0, ob: 0, ch: 'A' }
    ] });
    let previousIr = '';
    const importedIrIds = [];
    for (const [name, amplitude] of [['first-ir.wav', 0.8], ['second-ir.wav', 0.6]]) {
      const input = editor.locator('.ir-reverb-ui input[type="file"]').first();
      await input.setInputFiles({ name, mimeType: 'audio/wav', buffer: createImpulseWav(amplitude) });
      previousIr = await waitForImportedIr(editor, previousIr);
      importedIrIds.push(previousIr);
      await waitForSettledIr(editor, previousIr);
      assert.equal((await extensionRequest(editor, 'getState')).plugins[0].ir, previousIr);
    }
    const latestIrId = previousIr;
    assert.equal(new Set(importedIrIds).size, 2);
    const irLibrary = await modelRequest(editor, 'irLibrary', { method: 'list' });
    assert.ok(importedIrIds.every(irId => irLibrary.entries.some(entry => entry.irId === irId)));
    await modelRequest(editor, 'savePreset', { name: 'IR browser smoke' });
    const irPipelineFingerprint = JSON.stringify((await extensionRequest(editor, 'getState')).plugins);
    await assert.rejects(
      modelRequest(editor, 'setPipeline', { plugins: [
        {
          nm: 'IR Reverb', en: true, ir: '0123456789abcdef01234567',
          ib: 0, ob: 0, ch: 'A'
        }
      ] }),
      error => matchesExactEvaluationError(
        error,
        'These settings could not be applied. Check the effects, channels and impulse response files. Your previous pipeline has been kept.'
      )
    );
    await waitAndConsumeExpectedRuntimeConsoleError(
      offscreenRuntime,
      exactConsoleDiagnostic(
        'Editor update failed: Error: An impulse response is missing. ' +
          'Import its file in IR Reverb, then load this preset again.'
      ),
      'missing impulse response rejection'
    );
    assert.equal(JSON.stringify((await extensionRequest(editor, 'getState')).plugins),
      irPipelineFingerprint);

    const secondPage = await context.newPage();
    await secondPage.goto(`${baseURL}${fixturePath}?second=1`, { waitUntil: 'load' });
    await secondPage.click('#startAudio');
    const secondTabId = await editor.evaluate(async url => {
      const tabs = await chrome.tabs.query({});
      return tabs.find(tab => tab.url === url)?.id;
    }, secondPage.url());
    const duplicateStart = await extensionRequest(editor, 'start', { tabId: secondTabId });
    assert.equal(duplicateStart.target.tabId, sourceTabId);
    assert.equal((await editor.evaluate(() => chrome.tabCapture.getCapturedTabs()))
      .filter(item => item.status === 'active').length, 1);
    await secondPage.close();

    await modelRequest(editor, 'setPipeline', { plugins: [
      { nm: 'Volume', en: true, vl: -3, ib: 0, ob: 0, ch: 'A' }
    ] });
    await editor.close();
    await extensionRequest(controlPage, 'applyPreset', { name: 'Browser smoke' });
    assert.deepEqual((await extensionRequest(controlPage, 'getState')).plugins.map(plugin => plugin.nm),
      representativePipeline.map(plugin => plugin.nm));
    await extensionRequest(controlPage, 'applyPreset', { name: 'IR browser smoke' });
    const closedEditorIrState = await extensionRequest(controlPage, 'getState');
    assert.equal(closedEditorIrState.plugins[0].nm, 'IR Reverb');
    assert.equal(closedEditorIrState.plugins[0].ir, latestIrId);

    const workerTarget = await findTarget(
      cdp,
      target => target.type === 'service_worker' &&
        target.url === `chrome-extension://${extensionId}/extension/service-worker.js`,
      'the extension service worker target'
    );
    assert.deepEqual(workerRuntime.exceptions, []);
    assert.deepEqual(workerRuntime.consoleErrors, []);
    const retiredWorkerRuntime = workerRuntime;
    workerRuntime = null;
    await cdp.send('Target.closeTarget', { targetId: workerTarget.targetId });
    await waitForTargetGone(cdp, workerTarget.targetId, 'the extension service worker to stop');
    await retiredWorkerRuntime.detach();
    let recovered = await context.newPage();
    await recovered.goto(`chrome-extension://${extensionId}/extension/editor.html`, { waitUntil: 'load' });
    const recoveredState = await waitForState(recovered, {
      status: 'processing', tabId: sourceTabId
    }, 'The restarted service worker did not recover the offscreen session.');
    assert.equal(recoveredState.plugins[0].ir, latestIrId);
    assert.equal((await recovered.evaluate(() => chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT']
    }))).length, 1);
    const recoveredWorkerTarget = await findTarget(
      cdp,
      target => target.type === 'service_worker' &&
        target.url === `chrome-extension://${extensionId}/extension/service-worker.js`,
      'the restarted extension service worker target'
    );
    workerRuntime = await attachExistingRuntime(browserCdp, recoveredWorkerTarget);
    process.stdout.write('Editor closure, preset recall, and worker recovery passed.\n');

    await withTimeout(modelRequest(recovered, 'setPipeline', { plugins: [
      { nm: 'Volume', en: true, vl: -18, ib: 0, ob: 0, ch: 'A' }
    ] }), transitionTimeoutMs, 'The power-policy test pipeline update did not complete.');
    await waitForState(recovered, {
      status: 'processing', powerState: 'ACTIVE', tabId: sourceTabId
    }, 'The stateless pipeline did not settle in ACTIVE state.');
    await waitForPowerControllerSettled(
      offscreenRuntime,
      'The stateless pipeline power transition did not settle before the test-only settings change.'
    );
    assert.equal(await offscreenRuntime.evaluate(`(() => {
      const controller = window.audioManager.powerPolicyController;
      globalThis.__extensionSmokePowerSettings = { status: 'pending', error: null };
      Promise.resolve(controller.updateSettings({
        mode: 'maximum', silenceThresholdDb: -80, fullSuspendDelaySeconds: 60
      })).then(
        () => { globalThis.__extensionSmokePowerSettings.status = 'fulfilled'; },
        error => {
          globalThis.__extensionSmokePowerSettings.status = 'rejected';
          globalThis.__extensionSmokePowerSettings.error = error?.stack || error?.message || String(error);
        }
      );
      return controller.settings.fullSuspendDelaySeconds;
    })()`), 60);
    const powerSettingsDeadline = Date.now() + transitionTimeoutMs;
    let powerSettingsStatus;
    do {
      powerSettingsStatus = JSON.parse(await offscreenRuntime.evaluate(
        'JSON.stringify(globalThis.__extensionSmokePowerSettings)'
      ));
      if (powerSettingsStatus.status !== 'pending') break;
      await new Promise(resolve => setTimeout(resolve, 100));
    } while (Date.now() < powerSettingsDeadline);
    if (powerSettingsStatus.status !== 'fulfilled') {
      const diagnostics = await offscreenRuntime.evaluate(`JSON.stringify((() => {
        const controller = window.audioManager?.powerPolicyController;
        return {
          settingsStatus: globalThis.__extensionSmokePowerSettings,
          snapshot: controller?.getSnapshot?.(),
          reconcileRequested: controller?.reconcileRequested,
          pendingCommand: controller?.pendingCommand,
          observation: controller?.workletObservation
        };
      })())`);
      throw new Error(`Power settings reconciliation did not complete: ${diagnostics} ` +
        `Offscreen console: ${offscreenRuntime.logs.join(' | ')}`);
    }

    await recovered.close();
    await controlPage.close();
    process.stdout.write('Power deadline setup passed with control page and editor closed.\n');

    await sourcePage.evaluate(() => window.__browserExtensionAudio.pause());
    const silenceStartedAt = Date.now();
    await new Promise(resolve => setTimeout(resolve, 65_000));
    let monitoring = JSON.parse(await offscreenRuntime.evaluate(
      'JSON.stringify(window.audioManager?.getPowerSnapshot?.() || null)'
    ));
    process.stdout.write(`Power state after 65 seconds of silence: ${monitoring?.effectiveState}.\n`);
    if (monitoring?.effectiveState === 'ACTIVE') {
      monitoring = await waitForOffscreenPowerState(
        offscreenRuntime,
        'MONITORING',
        'Silent live capture did not demote to MONITORING.',
        65_000
      );
      process.stdout.write(`MONITORING reached after ${Date.now() - silenceStartedAt} ms of silence.\n`);
    }
    if (monitoring?.effectiveState !== 'MONITORING') {
      const powerDiagnostics = await offscreenRuntime.evaluate(
        'JSON.stringify(window.audioManager?.getPowerSnapshot?.())'
      );
      const fixtureDiagnostics = await sourcePage.evaluate(() =>
        window.__browserExtensionAudio.snapshot());
      throw new Error(`Silent live capture did not demote to MONITORING. ` +
        `Fixture: ${JSON.stringify(fixtureDiagnostics)} Power: ${powerDiagnostics}`);
    }
    const deadlineEvidence = JSON.parse(await offscreenRuntime.evaluate(`JSON.stringify((() => {
      const controller = window.audioManager?.powerPolicyController;
      const startAt = Math.max(
        controller?.hiddenSinceEpochMs,
        controller?.routedInputSilentSinceEpochMs,
        controller?.routedOutputSilentSinceEpochMs
      );
      return {
        now: Date.now(),
        startAt,
        fullSuspendDelaySeconds: controller?.settings?.fullSuspendDelaySeconds,
        automaticSuspendAllowed: controller?.automaticSuspendAllowed,
        effectiveState: controller?.getPowerSnapshot?.()?.effectiveState ||
          controller?.getSnapshot?.()?.effectiveState
      };
    })())`));
    assert.equal(deadlineEvidence.fullSuspendDelaySeconds, 60);
    assert.equal(deadlineEvidence.automaticSuspendAllowed, false);
    assert.ok(Number.isFinite(deadlineEvidence.startAt));
    const fullSuspendDeadlineAt = deadlineEvidence.startAt +
      deadlineEvidence.fullSuspendDelaySeconds * 1000;
    const deadlineWaitMs = fullSuspendDeadlineAt + 1000 - Date.now();
    if (deadlineWaitMs > 0) await new Promise(resolve => setTimeout(resolve, deadlineWaitMs));
    const postDeadline = JSON.parse(await offscreenRuntime.evaluate(`JSON.stringify({
      now: Date.now(),
      effectiveState: window.audioManager?.getPowerSnapshot?.()?.effectiveState,
      contextState: window.audioManager?.audioContext?.state,
      streamState: window.audioManager?.stream?.getAudioTracks?.()[0]?.readyState
    })`));
    assert.ok(postDeadline.now > fullSuspendDeadlineAt);
    assert.equal(postDeadline.effectiveState, 'MONITORING');
    process.stdout.write(
      `MONITORING retained ${postDeadline.now - fullSuspendDeadlineAt} ms past the ` +
      `${deadlineEvidence.fullSuspendDelaySeconds}-second full-suspend deadline.\n`
    );
    const monitoringResources = JSON.parse(await offscreenRuntime.evaluate(`JSON.stringify({
      contextState: window.audioManager?.audioContext?.state,
      streamState: window.audioManager?.stream?.getAudioTracks?.()[0]?.readyState
    })`));
    assert.equal(monitoringResources.contextState, 'running');
    assert.equal(monitoringResources.streamState, 'live');
    assert.equal(postDeadline.contextState, 'running');
    assert.equal(postDeadline.streamState, 'live');
    assert.equal((await sourcePage.evaluate(() => window.__browserExtensionAudio.resume())).state, 'running');
    await waitForOffscreenPowerState(
      offscreenRuntime,
      'ACTIVE',
      'Source-only playback did not wake the captured pipeline.',
      transitionTimeoutMs
    );
    recovered = await context.newPage();
    await recovered.goto(`chrome-extension://${extensionId}/extension/editor.html`, { waitUntil: 'load' });
    await waitForState(recovered, {
      status: 'processing', powerState: 'ACTIVE', tabId: sourceTabId
    }, 'The extension control page did not reflect the source-only wake.', transitionTimeoutMs);

    await modelRequest(recovered, 'setPipeline', { plugins: [
      { nm: 'Dattorro Plate Reverb', en: true, ib: 0, ob: 0, ch: 'A' },
      { nm: 'Oscillator', en: true, vl: -24, ib: 0, ob: 0, ch: 'A' }
    ] });
    const generating = JSON.parse(await offscreenRuntime.evaluate(`JSON.stringify({
      contextState: window.audioManager?.audioContext?.state,
      streamState: window.audioManager?.stream?.getAudioTracks?.()[0]?.readyState,
      dsp: window.audioManager?.getDspExecutionStateSnapshot?.()
    })`));
    assert.equal(generating.contextState, 'running');
    assert.equal(generating.streamState, 'live');
    assert.equal(generating.dsp.states.length, 2);
    assert.ok(generating.dsp.states.every(item => item.state === 'active'));
    await extensionRequest(recovered, 'stop');
    const stopped = await waitForState(recovered, { status: 'stopped' },
      'The extension did not stop.');
    assert.equal(stopped.target, null);
    assert.equal((await recovered.evaluate(() => chrome.tabCapture.getCapturedTabs()))
      .some(item => item.status === 'active' || item.status === 'pending'), false);
    assert.equal((await sourcePage.evaluate(() => window.__browserExtensionAudio.snapshot())).state, 'running');
    const released = JSON.parse(await offscreenRuntime.evaluate(`JSON.stringify({
      context: window.audioManager?.audioContext || null,
      stream: window.audioManager?.stream || null,
      pipeline: window.audioManager?.pipeline?.map(plugin => plugin.name)
    })`));
    assert.equal(released.context, null);
    assert.equal(released.stream, null);
    assert.deepEqual(released.pipeline, ['Dattorro Plate Reverb', 'Oscillator']);

    await recovered.close();
    await controlPage.close().catch(() => {});
    assert.deepEqual([...new Set(externalRequests)], []);
    assert.deepEqual(errors, []);
    assert.deepEqual(offscreenRuntime.exceptions, []);
    assert.deepEqual(offscreenRuntime.consoleErrors, []);
    assert.deepEqual(workerRuntime.exceptions, []);
    assert.deepEqual(workerRuntime.consoleErrors, []);
    assert.deepEqual(
      offscreenRuntime.logs.filter(message => message.includes('[AudioContext] closed unexpectedly')),
      []
    );
    return { browserName: 'chromium', browserVersion, extensionId };
  } finally {
    await workerRuntime?.detach().catch(() => {});
    await offscreenRuntime?.detach().catch(() => {});
    browserCdp?.close();
    await cdp?.detach().catch(() => {});
    await context.close().catch(() => {});
  }
}

export async function runExtensionBrowserSmoke() {
  await validateDistribution();
  const { chromium } = await loadPlaywright();
  let server;
  let profilePath;
  let resolvedProfile;
  let ownedContext;
  let result;
  try {
    profilePath = await fs.mkdtemp(path.join(os.tmpdir(), 'effetune-extension-smoke-'));
    resolvedProfile = path.resolve(profilePath);
    const resolvedTemp = path.resolve(os.tmpdir());
    assert.ok(
      resolvedProfile.startsWith(`${resolvedTemp}${path.sep}`) &&
        path.basename(resolvedProfile).startsWith('effetune-extension-smoke-'),
      'The temporary browser profile path is outside the expected directory.'
    );
    server = await startIsolatedStaticServer();
    result = await withTimeout(
      runBrowserScenario({
        chromium,
        baseURL: server.baseURL,
        profilePath,
        onContext: context => { ownedContext = context; }
      }),
      testTimeoutMs,
      `Extension browser smoke exceeded ${testTimeoutMs} ms.`
    );
  } finally {
    await ownedContext?.close().catch(() => {});
    await ownedContext?.browser()?.close().catch(() => {});
    if (server) await stopIsolatedStaticServer(server.child);
    if (resolvedProfile) {
      await fs.rm(resolvedProfile, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    }
  }
  process.stdout.write(
    `Extension browser smoke passed (${result.browserName} ${result.browserVersion}, ${result.extensionId}).\n`
  );
}

function printHelp() {
  process.stdout.write([
    'Usage: node tools/run-extension-browser-smoke.mjs',
    '',
    'Loads out/extension through its real Manifest V3 entry points and exercises tab capture,',
    'the WASM pipeline, editor telemetry, persistence, worker recovery, power wake, and cleanup.',
    'Bundled Chromium is headed by default because headless Chromium does not route tab audio.',
    'Set EXTENSION_BROWSER_HEADLESS=1 only when testing extension startup without audio proof.',
    ''
  ].join('\n'));
}

const isDirect = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isDirect) {
  if (process.argv.includes('--help')) {
    printHelp();
  } else {
    runExtensionBrowserSmoke().catch(error => {
      process.stderr.write(`${error.stack || error.message}\n`);
      process.exitCode = 1;
    });
  }
}
