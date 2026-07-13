import { fork } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const POWER_SMOKE_FIXTURE_PATH = '/__power-policy-smoke__/index.html';
const POWER_SMOKE_OLD_SW_PATH = '/__power-policy-smoke__/old-sw.js';

const modulePath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(modulePath), '..');
const host = '127.0.0.1';
const startupTimeoutMs = 10_000;
const shutdownTimeoutMs = 5_000;
const testTimeoutMs = 60_000;

const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.wasm', 'application/wasm']
]);

const oldServiceWorkerFixture = String.raw`
const CACHE_VERSION = 'effetune-v-browser-smoke-old';
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_VERSION).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});
`;

const fixtureHtml = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>EffeTune power policy browser smoke</title>
</head>
<body>
  <main id="status">Preparing power policy smoke fixture…</main>
  <script type="module">
    import {
      AudioPowerState,
      AutomaticMonitoringArmState,
      InputAvailability,
      InputResourceState,
      InputRouteIntent,
      MonitoringFastWakeBlockerReason,
      PowerPolicy,
      ProcessingDirective,
      decidePowerTarget,
      deriveInputSignalObservation
    } from '/js/audio/power-policy.js';
    import { PowerPolicyController } from '/js/audio/power-policy-controller.js';

    const SCENARIO_NOW = 1_000_000;
    const activeResources = new Set();
    const POWER_COUNTER_KEYS = Object.freeze([
      'renderQuanta',
      'detectorQuanta',
      'fullProcessQuanta',
      'fullJsProcessQuanta',
      'fullWasmProcessQuanta',
      'monitoringQuanta',
      'bypassQuanta',
      'zeroOutputQuanta',
      'telemetryReads',
      'telemetryPosts',
      'monitoringRuntimeFailures'
    ]);
    let nextCommandId = 1;
    let nextObservationRequestId = 1;
    function disarmedArm() {
      return {
        state: AutomaticMonitoringArmState.DISARMED,
        commandId: null,
        skipEpoch: null,
        armAfterRenderSequence: null
      };
    }

    function probeControllerEnablement(options = {}) {
      const fakeWindow = {
        location: { search: options.search || '' },
        document: window.document,
        sessionStorage: window.sessionStorage,
        localStorage: window.localStorage,
        crypto: window.crypto
      };
      if (options.powerPolicyEnabled !== undefined) {
        fakeWindow.appConfig = { powerPolicyEnabled: options.powerPolicyEnabled };
      }
      const controller = new PowerPolicyController({}, { windowRef: fakeWindow });
      return { enabled: controller.isControllerEnabled() };
    }

    async function createLiveMic() {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Chromium did not expose getUserMedia for the localhost fixture.');
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const track = stream.getAudioTracks()[0];
      if (!track) throw new Error('The Chromium fake media device returned no audio track.');
      let stopCalls = 0;
      return {
        track,
        get stopCalls() {
          return stopCalls;
        },
        stop() {
          stopCalls += 1;
          track.stop();
        }
      };
    }

    function wait(delayMs) {
      return new Promise(resolve => setTimeout(resolve, delayMs));
    }

    function createMessageObserver(port) {
      const messages = [];
      const waiters = new Set();
      port.onmessage = event => {
        messages.push(event.data);
        for (const waiter of [...waiters]) {
          if (!waiter.predicate(event.data)) continue;
          waiters.delete(waiter);
          clearTimeout(waiter.timeoutId);
          waiter.resolve(event.data);
        }
      };
      port.start?.();
      return {
        messages,
        waitFor(predicate, timeoutMs = 4_000) {
          const existing = messages.find(predicate);
          if (existing) return Promise.resolve(existing);
          return new Promise((resolve, reject) => {
            const waiter = {
              predicate,
              resolve,
              reject,
              timeoutId: setTimeout(() => {
                waiters.delete(waiter);
                reject(new Error('Timed out waiting for an AudioWorklet power message.'));
              }, timeoutMs)
            };
            waiters.add(waiter);
          });
        },
        dispose() {
          for (const waiter of waiters) {
            clearTimeout(waiter.timeoutId);
            waiter.reject?.(new Error('AudioWorklet message observer disposed.'));
          }
          waiters.clear();
          port.onmessage = null;
        }
      };
    }

    async function createRunningAudioWorklet(mic) {
      const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Context) throw new Error('Chromium did not expose AudioContext.');
      const context = new Context();
      await context.audioWorklet.addModule('/plugins/audio-processor.js');
      const node = new AudioWorkletNode(context, 'plugin-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: 'max',
        processorOptions: {
          initialOutputChannelCount: 2,
          lowLatencyMode: true
        }
      });
      const source = context.createMediaStreamSource(new MediaStream([mic.track]));
      const routeGate = context.createGain();
      routeGate.gain.value = 0;
      source.connect(routeGate).connect(node).connect(context.destination);
      const observer = createMessageObserver(node.port);
      await context.resume();
      if (context.state !== 'running') {
        observer.dispose();
        node.disconnect();
        routeGate.disconnect();
        source.disconnect();
        await context.close();
        throw new Error('The smoke AudioContext could not enter running state.');
      }
      return { context, node, observer, routeGate, source };
    }

    function counterDelta(before, after) {
      const delta = {};
      for (const key of POWER_COUNTER_KEYS) {
        delta[key] = Number(after?.[key] || 0) - Number(before?.[key] || 0);
      }
      return delta;
    }

    async function waitForCommandAck(resource, commandId, predicate = () => true) {
      return resource.observer.waitFor(message =>
        message?.type === 'powerStateAck' &&
        message.commandId === commandId &&
        predicate(message)
      );
    }

    async function requestPowerObservation(resource, identity) {
      const observationRequestId = nextObservationRequestId++;
      resource.node.port.postMessage({
        type: 'requestPowerObservation',
        observationRequestId,
        ...identity
      });
      return resource.observer.waitFor(message =>
        (message?.type === 'powerObservation' || message?.type === 'powerHeartbeat') &&
        message.observationRequestId === observationRequestId
      );
    }

    async function configureWorklet(resource, options) {
      const identity = {
        workletGraphGeneration: nextCommandId++,
        topologyRevision: nextCommandId++
      };
      const plugin = {
        id: 'power-smoke-must-process',
        type: 'PowerSmokeMustProcess',
        enabled: true,
        inputBus: 0,
        outputBus: 0,
        channel: 'A',
        parameters: { enabled: true, inputBus: 0, outputBus: 0, channel: 'A' }
      };
      if (options.mustProcess === true) {
        resource.node.port.postMessage({
          type: 'registerProcessor',
          pluginType: plugin.type,
          processor: 'for (let i = 0; i < data.length; i++) data[i] *= 1; return data;'
        });
        resource.node.port.postMessage({
          type: 'updatePlugins',
          plugins: [plugin],
          masterBypass: false
        });
      } else {
        resource.node.port.postMessage({
          type: 'updatePlugins',
          plugins: [],
          masterBypass: false
        });
      }

      const commandId = nextCommandId++;
      resource.node.port.postMessage({
        type: 'configurePowerPolicy',
        commandId,
        enabled: true,
        silenceThresholdDb: -80,
        silenceDurationSeconds: 0,
        wakeGainMarginDb: 0,
        monitoringFastWakeEligible: options.mustProcess !== true,
        monitoringFastWakeBlockerReason: options.mustProcess === true ? 'must-process' : null,
        temporalSkipEligible: options.mustProcess !== true,
        enabledPluginCount: options.mustProcess === true ? 1 : 0,
        monitoringPreparationCapabilities: options.mustProcess === true
          ? [{ pluginId: plugin.id, capability: 'must-process' }]
          : [],
        ...identity
      });
      const configureAck = await waitForCommandAck(
        resource,
        commandId,
        message => message.configured === true
      );
      return { configureAck, identity };
    }

    async function applyWorkletDecision(resource, options, decision) {
      const { configureAck, identity } = await configureWorklet(resource, options);
      let unsafeMonitoringProbeAck = null;
      if (options.mustProcess === true) {
        const probeCommandId = nextCommandId++;
        resource.node.port.postMessage({
          type: 'setPowerProcessingState',
          commandId: probeCommandId,
          skipEpoch: probeCommandId,
          state: 'monitoring',
          processingDirective: 'force-monitoring',
          ...identity
        });
        unsafeMonitoringProbeAck = await waitForCommandAck(resource, probeCommandId);
      }

      const appliedDirective = decision.targetState === AudioPowerState.SUSPENDED
        ? ProcessingDirective.FORCE_MONITORING
        : decision.processingDirective;
      const commandId = nextCommandId++;
      resource.node.port.postMessage({
        type: 'setPowerProcessingState',
        commandId,
        skipEpoch: commandId,
        state: decision.targetState === AudioPowerState.MONITORING ? 'monitoring' : 'active',
        processingDirective: appliedDirective,
        ...identity
      });
      const applyAck = await waitForCommandAck(resource, commandId);
      const before = await requestPowerObservation(resource, identity);
      await wait(80);
      const after = await requestPowerObservation(resource, identity);
      const runningDelta = counterDelta(before.counters, after.counters);

      let suspension = null;
      if (decision.targetState === AudioPowerState.SUSPENDED) {
        await resource.context.suspend();
        const suspendedState = resource.context.state;
        const suspendedObservationRequestId = nextObservationRequestId++;
        let observationSettledWhileSuspended = false;
        const resumedObservationPromise = resource.observer.waitFor(message =>
          (message?.type === 'powerObservation' || message?.type === 'powerHeartbeat') &&
          message.observationRequestId === suspendedObservationRequestId
        ).then(message => {
          observationSettledWhileSuspended = resource.context.state === 'suspended';
          return message;
        });
        resource.node.port.postMessage({
          type: 'requestPowerObservation',
          observationRequestId: suspendedObservationRequestId,
          ...identity
        });
        await wait(80);
        const noRenderMessageWhileSuspended = !observationSettledWhileSuspended;
        await resource.context.resume();
        const firstResumedObservation = await resumedObservationPromise;
        suspension = {
          state: suspendedState,
          noRenderMessageWhileSuspended,
          firstResumedRenderSequence: firstResumedObservation.renderSequence,
          renderSequenceBeforeSuspend: after.renderSequence
        };
      }

      return {
        configured: configureAck.configured,
        runtimeNodes: {
          worklet: resource.node.constructor.name,
          inputSource: resource.source.constructor.name,
          routeGate: resource.routeGate.constructor.name,
          inputTrackReadyState: resource.mic.track.readyState
        },
        appliedDirective: applyAck.processingDirective,
        appliedState: applyAck.state,
        runningDelta,
        before: {
          state: before.state,
          processingDirective: before.processingDirective,
          renderSequence: before.renderSequence,
          counters: before.counters
        },
        after: {
          state: after.state,
          processingDirective: after.processingDirective,
          renderSequence: after.renderSequence,
          counters: after.counters
        },
        unsafeMonitoringProbe: unsafeMonitoringProbeAck && {
          requestedDirective: 'force-monitoring',
          appliedDirective: unsafeMonitoringProbeAck.processingDirective,
          appliedState: unsafeMonitoringProbeAck.state
        },
        suspension
      };
    }

    function makeFacts(options) {
      const mustProcess = options.mustProcess === true;
      return {
        enabled: true,
        isElectron: false,
        visibility: options.visibility || 'visible',
        pageLifecycle: options.visibility === 'hidden' ? 'hidden' : 'active',
        effectiveState: AudioPowerState.ACTIVE,
        desiredState: AudioPowerState.ACTIVE,
        processingDirective: ProcessingDirective.FULL_PROCESS,
        inputConfigured: true,
        inputRouteIntent: options.routeIntent || InputRouteIntent.PLAYER_ONLY,
        inputResourceState: InputResourceState.LIVE,
        inputAvailability: InputAvailability.AVAILABLE,
        inputConfigRevision: 2,
        inputGeneration: 7,
        inputAvailabilityRevision: 11,
        routeIntentRevision: 13,
        playerState: options.playerState,
        transportDemand: false,
        dspProcessingDemand: false,
        inputSignalState: 'active',
        rawMicSignalState: 'active',
        routedInputSignalState: 'silent',
        routedOutputSignalState: 'silent',
        routedInputObservationFresh: true,
        routedOutputObservationFresh: true,
        outputSignalState: 'silent',
        temporalSkipEligible: !mustProcess,
        temporalSkipReason: mustProcess
          ? MonitoringFastWakeBlockerReason.MUST_PROCESS
          : null,
        temporalCapabilityAggregate: mustProcess ? 'must-process' : 'stateless',
        monitoringFastWakeEligible: !mustProcess,
        monitoringFastWakeBlockerReason: mustProcess
          ? MonitoringFastWakeBlockerReason.MUST_PROCESS
          : null,
        workletControl: { automaticMonitoringArm: disarmedArm() },
        workletObservedState: 'active',
        workletObservationFresh: true,
        activeFullProcessSettled: true,
        freshActiveRenderSequence: 17,
        renderSequence: 17,
        observationRequestId: 19,
        resourceHealth: mustProcess ? 'degraded' : 'healthy',
        forceActiveLeases: 0,
        fullProcessLeases: 0,
        holdCurrentLeases: 0,
        resourceMutationInProgress: false,
        manualResumeRequired: false,
        resumeKind: 'none',
        policyGeneration: 3,
        topologyRevision: 5,
        workletGraphGeneration: 6,
        noRouteIdleSinceEpochMs: SCENARIO_NOW - options.noRouteElapsedMs,
        inputUnusedSinceEpochMs: SCENARIO_NOW - options.inputUnusedElapsedMs,
        inputUnusedInputGeneration: 7
      };
    }

    async function runPlayerOnlyScenario(options) {
      const mic = await createLiveMic();
      const worklet = await createRunningAudioWorklet(mic);
      const resource = { mic, ...worklet };
      activeResources.add(resource);
      let inputReleaseCalls = 0;
      try {
        const facts = makeFacts(options);
        const settings = {
          mode: options.mode,
          silenceThresholdDb: -80,
          fullSuspendDelaySeconds: options.fullSuspendDelaySeconds
        };
        const inputObservation = deriveInputSignalObservation(facts);
        const decision = decidePowerTarget(facts, settings, SCENARIO_NOW);
        const workletEvidence = await applyWorkletDecision(resource, options, decision);
        if (decision.shouldReleaseInput && options.applyInputRelease === true) {
          mic.stop();
          inputReleaseCalls += 1;
        }

        return {
          mode: options.mode,
          playerState: options.playerState,
          targetState: decision.targetState,
          processingDirective: decision.processingDirective,
          inputSignalForProcessing: decision.inputSignalForProcessing,
          inputSignalReason: inputObservation.reason,
          inputRetentionTarget: decision.inputRetentionTarget,
          shouldReleaseInput: decision.shouldReleaseInput,
          releaseCause: decision.inputReleaseRequest?.releaseCause || null,
          manualResumeRequired: decision.manualResumeRequired,
          trackReadyState: mic.track.readyState,
          trackStopCalls: mic.stopCalls,
          contextState: workletEvidence.suspension?.state || resource.context.state,
          contextSuspendCalls: workletEvidence.suspension ? 1 : 0,
          inputReleaseCalls,
          workletEvidence
        };
      } finally {
        if (mic.track.readyState === 'live') mic.stop();
        resource.observer.dispose();
        resource.node.disconnect();
        resource.routeGate.disconnect();
        resource.source.disconnect();
        await resource.context.close();
        activeResources.delete(resource);
      }
    }

    async function waitForServiceWorkerState(worker, targetState, timeoutMs = 15_000) {
      if (!worker) throw new Error('Service worker registration returned no worker.');
      if (worker.state === targetState) return;
      await new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          worker.removeEventListener('statechange', onStateChange);
          reject(new Error('Timed out waiting for service worker state ' + targetState + '.'));
        }, timeoutMs);
        function onStateChange() {
          if (worker.state === 'redundant') {
            clearTimeout(timeoutId);
            worker.removeEventListener('statechange', onStateChange);
            reject(new Error('Service worker became redundant during installation.'));
          } else if (worker.state === targetState) {
            clearTimeout(timeoutId);
            worker.removeEventListener('statechange', onStateChange);
            resolve();
          }
        }
        worker.addEventListener('statechange', onStateChange);
      });
    }

    async function waitForRegistrationWorker(registration, scriptPath, timeoutMs = 15_000) {
      const matches = worker => worker && new URL(worker.scriptURL).pathname === scriptPath;
      const current = [registration.installing, registration.waiting, registration.active]
        .find(matches);
      if (current) return current;
      return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          registration.removeEventListener('updatefound', onUpdateFound);
          reject(new Error('Timed out waiting for service worker script ' + scriptPath + '.'));
        }, timeoutMs);
        function onUpdateFound() {
          if (!matches(registration.installing)) return;
          clearTimeout(timeoutId);
          registration.removeEventListener('updatefound', onUpdateFound);
          resolve(registration.installing);
        }
        registration.addEventListener('updatefound', onUpdateFound);
      });
    }

    async function verifyServiceWorkerPrecache() {
      if (!('serviceWorker' in navigator) || !('caches' in globalThis)) {
        return { supported: false };
      }
      const precacheSource = await fetch('/sw-precache.js', { cache: 'no-store' }).then(response => {
        if (!response.ok) {
          throw new Error('sw-precache.js returned ' + response.status + '.');
        }
        return response.text();
      });
      const versionMatch = precacheSource.match(/EFFECTUNE_CACHE_VERSION\s*=\s*["']([^"']+)/);
      if (!versionMatch) throw new Error('Generated precache has no cache version.');
      const cacheVersion = versionMatch[1];
      const oldCacheVersion = 'effetune-v-browser-smoke-old';
      const oldRegistration = await navigator.serviceWorker.register(
        '/__power-policy-smoke__/old-sw.js',
        { scope: '/', updateViaCache: 'none' }
      );
      const oldWorker = await waitForRegistrationWorker(
        oldRegistration,
        '/__power-policy-smoke__/old-sw.js'
      );
      await waitForServiceWorkerState(oldWorker, 'activated');
      await navigator.serviceWorker.ready;

      const registration = await navigator.serviceWorker.register('/sw.js', {
        scope: '/',
        updateViaCache: 'none'
      });
      const installingWorker = await waitForRegistrationWorker(registration, '/sw.js');
      await waitForServiceWorkerState(installingWorker, 'activated');

      const cacheKeys = await caches.keys();
      const cache = await caches.open(cacheVersion);
      const [workletResponse, snapshotResponse] = await Promise.all([
        cache.match(new URL('/plugins/audio-processor.js', location.href)),
        cache.match(new URL('/js/audio/power-snapshot.js', location.href))
      ]);
      const snapshotSource = snapshotResponse ? await snapshotResponse.clone().text() : '';
      const schemaVersionMatch = snapshotSource.match(
        /POWER_SNAPSHOT_SCHEMA_VERSION\s*=\s*(\d+)/
      );
      return {
        supported: true,
        oldWorkerScript: oldWorker.scriptURL,
        activeWorkerScript: registration.active?.scriptURL || null,
        cacheVersion,
        oldCacheRemoved: !cacheKeys.includes(oldCacheVersion),
        workletPrecached: Boolean(workletResponse),
        snapshotPrecached: Boolean(snapshotResponse),
        snapshotSchemaVersion: schemaVersionMatch ? Number(schemaVersionMatch[1]) : null
      };
    }

    async function dispose() {
      for (const resource of [...activeResources]) {
        if (resource.mic.track.readyState === 'live') resource.mic.stop();
        resource.observer.dispose();
        resource.node.disconnect();
        resource.routeGate.disconnect();
        resource.source.disconnect();
        await resource.context.close();
        activeResources.delete(resource);
      }
    }

    window.__powerPolicySmoke = Object.freeze({
      ready: true,
      policies: Object.freeze({ ...PowerPolicy }),
      runPlayerOnlyScenario,
      probeControllerEnablement,
      verifyServiceWorkerPrecache,
      dispose
    });
    document.getElementById('status').textContent = 'Power policy smoke fixture ready';
    window.dispatchEvent(new Event('power-policy-smoke-ready'));
  </script>
</body>
</html>`;

function getRequestPath(requestUrl) {
  try {
    return decodeURIComponent(new URL(requestUrl, `http://${host}`).pathname);
  } catch {
    return null;
  }
}

function resolveStaticPath(requestPath) {
  const relativePath = requestPath.replace(/^\/+/, '');
  const absolutePath = path.resolve(repoRoot, relativePath);
  if (absolutePath === repoRoot || absolutePath.startsWith(`${repoRoot}${path.sep}`)) {
    return absolutePath;
  }
  return null;
}

function setResponseHeaders(response, contentType) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  response.setHeader('Content-Type', contentType);
}

function sendText(response, statusCode, body, contentType = 'text/plain; charset=utf-8') {
  response.statusCode = statusCode;
  setResponseHeaders(response, contentType);
  response.end(body);
}

function createStaticServer() {
  return http.createServer((request, response) => {
    const requestPath = getRequestPath(request.url || '/');
    if (!requestPath) {
      sendText(response, 400, 'Bad request');
      return;
    }
    if (requestPath === '/favicon.ico') {
      response.statusCode = 204;
      response.end();
      return;
    }
    if (requestPath === POWER_SMOKE_FIXTURE_PATH) {
      sendText(response, 200, fixtureHtml, 'text/html; charset=utf-8');
      return;
    }
    if (requestPath === POWER_SMOKE_OLD_SW_PATH) {
      response.statusCode = 200;
      setResponseHeaders(response, 'text/javascript; charset=utf-8');
      response.setHeader('Service-Worker-Allowed', '/');
      response.end(oldServiceWorkerFixture);
      return;
    }
    const absolutePath = resolveStaticPath(requestPath);
    if (!absolutePath) {
      sendText(response, 403, 'Forbidden');
      return;
    }
    let stats;
    try {
      stats = fs.statSync(absolutePath);
    } catch {
      sendText(response, 404, 'Not found');
      return;
    }
    if (!stats.isFile()) {
      sendText(response, 404, 'Not found');
      return;
    }
    const contentType = contentTypes.get(path.extname(absolutePath).toLowerCase()) ||
      'application/octet-stream';
    response.statusCode = 200;
    setResponseHeaders(response, contentType);
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    const stream = fs.createReadStream(absolutePath);
    stream.on('error', error => {
      if (!response.headersSent) sendText(response, 500, error.message);
      else response.destroy(error);
    });
    stream.pipe(response);
  });
}

function withTimeout(promise, timeoutMs, message) {
  let timeoutId;
  const timeout = new Promise((resolve, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

export async function runServerProcess() {
  const server = createStaticServer();
  let closing = false;
  const close = () => {
    if (closing) return;
    closing = true;
    server.close(() => process.exitCode = 0);
  };
  process.on('message', message => {
    if (message?.type === 'shutdown') close();
  });
  process.on('disconnect', close);
  process.on('SIGINT', close);
  process.on('SIGTERM', close);
  server.on('error', error => {
    process.send?.({ type: 'server-error', message: error.message });
    process.exitCode = 1;
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Static server address unavailable.');
  process.send?.({ type: 'server-ready', host, port: address.port });
}

export async function startIsolatedStaticServer() {
  const logs = [];
  const child = fork(modulePath, ['--serve'], {
    cwd: repoRoot,
    env: { ...process.env, NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc']
  });
  child.stdout?.on('data', chunk => logs.push(String(chunk)));
  child.stderr?.on('data', chunk => logs.push(String(chunk)));
  const ready = new Promise((resolve, reject) => {
    child.on('message', message => {
      if (message?.type === 'server-ready') resolve(message);
      if (message?.type === 'server-error') reject(new Error(message.message));
    });
    child.once('error', reject);
    child.once('exit', code => {
      reject(new Error(`Static server exited before ready (code ${code}). ${logs.join('').trim()}`));
    });
  });
  try {
    const address = await withTimeout(
      ready,
      startupTimeoutMs,
      'Timed out waiting for the isolated power-browser static server.'
    );
    return { child, baseURL: `http://${address.host}:${address.port}` };
  } catch (error) {
    child.kill();
    throw error;
  }
}

export async function stopIsolatedStaticServer(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  if (child.connected) child.send({ type: 'shutdown' });
  try {
    await withTimeout(exited, shutdownTimeoutMs, 'Static server shutdown timed out.');
  } catch {
    child.kill();
    await withTimeout(exited, shutdownTimeoutMs, 'Static server could not be terminated.');
  }
}

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch (error) {
    if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error;
    throw new Error(
      'Playwright is required for the power browser smoke. ' +
      'Install dependencies with "npm ci" (playwright is a pinned devDependency), then run ' +
      '"npx playwright install chromium" before retrying.',
      { cause: error }
    );
  }
}

async function loadSmokeSpec() {
  const spec = await import('../tests/browser/power-policy-smoke.spec.mjs');
  if (typeof spec.runPowerPolicyBrowserSmoke !== 'function') {
    throw new TypeError('power-policy-smoke.spec.mjs must export runPowerPolicyBrowserSmoke().');
  }
  return spec.runPowerPolicyBrowserSmoke;
}

export async function runPowerBrowserSmoke() {
  const [{ chromium }, runSmoke] = await Promise.all([loadPlaywright(), loadSmokeSpec()]);
  const server = await startIsolatedStaticServer();
  let browser = null;
  try {
    try {
      browser = await chromium.launch({
        headless: process.env.POWER_BROWSER_HEADED !== '1',
        args: [
          '--autoplay-policy=no-user-gesture-required',
          '--use-fake-device-for-media-stream',
          '--use-fake-ui-for-media-stream'
        ]
      });
    } catch (error) {
      throw new Error(
        'Chromium could not start for the power browser smoke. ' +
        'Run "npx playwright install chromium" and retry.',
        { cause: error }
      );
    }
    await withTimeout(
      runSmoke({ browser, baseURL: server.baseURL }),
      testTimeoutMs,
      `Power browser smoke exceeded ${testTimeoutMs} ms.`
    );
    process.stdout.write('Power browser smoke passed.\n');
  } finally {
    await browser?.close().catch(() => {});
    await stopIsolatedStaticServer(server.child);
  }
}

function printHelp() {
  process.stdout.write([
    'Usage: node tools/run-power-browser-smoke.mjs',
    '',
    'Runs the mandatory EffeTune power-policy smoke in Playwright Chromium.',
    'Set POWER_BROWSER_HEADED=1 to show the browser.',
    ''
  ].join('\n'));
}

const isDirect = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isDirect) {
  if (process.argv.includes('--serve')) {
    runServerProcess().catch(error => {
      process.stderr.write(`${error.stack || error.message}\n`);
      process.exitCode = 1;
    });
  } else if (process.argv.includes('--help')) {
    printHelp();
  } else {
    runPowerBrowserSmoke().catch(error => {
      process.stderr.write(`${error.stack || error.message}\n`);
      process.exitCode = 1;
    });
  }
}
