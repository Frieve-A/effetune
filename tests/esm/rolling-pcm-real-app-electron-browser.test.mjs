import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { _electron as electron } from 'playwright';

const repoRoot = path.resolve('.');
const SOURCE_FRAMES = 44_100 * 3;
const captureWorkletSource = `
class RollingRealAppCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.enabled = false;
    this.lastFrame = null;
    this.missingBlocks = 0;
    this.duplicateBlocks = 0;
    this.nonFinite = 0;
    this.unexpectedZero = 0;
    this.seenBlocks = 0;
    this.trackOneBlocks = 0;
    this.trackTwoBlocks = 0;
    this.emptyBlocksAfterStart = 0;
    this.port.onmessage = event => {
      if (event.data?.type === 'start') this.enabled = true;
      if (event.data?.type === 'stop') {
        this.enabled = false;
        this.port.postMessage({ type: 'summary', ...this.summary() });
      }
    };
  }
  summary() {
    return {
      seenBlocks: this.seenBlocks,
      missingBlocks: this.missingBlocks,
      duplicateBlocks: this.duplicateBlocks,
      nonFinite: this.nonFinite,
      unexpectedZero: this.unexpectedZero,
      trackOneBlocks: this.trackOneBlocks,
      trackTwoBlocks: this.trackTwoBlocks,
      emptyBlocksAfterStart: this.emptyBlocksAfterStart
    };
  }
  process(inputs, outputs) {
    const input = inputs[0] || [];
    const output = outputs[0] || [];
    for (let channel = 0; channel < output.length; channel++) {
      if (input[channel]) output[channel].set(input[channel]);
      else output[channel].fill(0);
    }
    if (!this.enabled) return true;
    if (input.length < 2 || !input[0]?.length) {
      // Once audio has been observed, a block without input means the pipeline
      // went quiet before the capture was stopped (a next track starting late).
      if (this.seenBlocks > 0) this.emptyBlocksAfterStart++;
      return true;
    }
    // missingBlocks / duplicateBlocks are diagnostics only: currentFrame is the render
    // clock, and Chromium may re-issue the same quantum around the boundary graph
    // changes (next transport connect / old transport dispose), so they are not asserted.
    if (this.lastFrame !== null) {
      if (currentFrame > this.lastFrame + 128) this.missingBlocks += (currentFrame - this.lastFrame) / 128 - 1;
      if (currentFrame <= this.lastFrame) this.duplicateBlocks++;
    }
    this.lastFrame = currentFrame;
    this.seenBlocks++;
    let mean = 0;
    for (const plane of input) {
      for (let frame = 0; frame < plane.length; frame++) {
        const sample = plane[frame];
        if (!Number.isFinite(sample)) this.nonFinite++;
        if (sample === 0) this.unexpectedZero++;
        mean += sample;
      }
    }
    mean /= input.length * input[0].length;
    if (mean > 0 && mean < 0.45) this.trackOneBlocks++;
    if (mean >= 0.45) this.trackTwoBlocks++;
    return true;
  }
}
registerProcessor('rolling-real-app-capture', RollingRealAppCaptureProcessor);
`;

function createStrictStereoWav(seed) {
  const bytes = new ArrayBuffer(44 + SOURCE_FRAMES * 4);
  const view = new DataView(bytes);
  const writeAscii = (offset, value) => {
    for (let index = 0; index < value.length; index++) view.setUint8(offset + index, value.charCodeAt(index));
  };
  writeAscii(0, 'RIFF');
  view.setUint32(4, bytes.byteLength - 8, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, 44_100, true);
  view.setUint32(28, 176_400, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, bytes.byteLength - 44, true);
  for (let frame = 0; frame < SOURCE_FRAMES; frame++) {
    for (let channel = 0; channel < 2; channel++) {
      // Both fixtures are strictly non-zero. Their separated positive ranges make the
      // capture worklet identify the automatic boundary without a test-only marker path.
      const value = seed + ((frame * (channel + 11)) % 4_000);
      view.setInt16(44 + (frame * 2 + channel) * 2, value, true);
    }
  }
  return new Uint8Array(bytes);
}

async function startFixtureServer() {
  const server = createServer(async (request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end('<!doctype html><title>Rolling PCM real Electron fixture</title>');
      return;
    }
    if (pathname === '/tests/rolling-real-app-capture-worklet.js') {
      response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(captureWorkletSource);
      return;
    }
    try {
      const filePath = path.resolve(repoRoot, `.${pathname}`);
      if (!filePath.startsWith(`${repoRoot}${path.sep}`)) throw new Error('outside fixture root');
      const body = await readFile(filePath);
      response.writeHead(200, {
        'Content-Type': pathname.endsWith('.js') || pathname.endsWith('.mjs')
          ? 'text/javascript; charset=utf-8'
          : 'application/octet-stream',
        'Cache-Control': 'no-store'
      });
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve, reject) => {
      server.closeAllConnections();
      server.close(error => error ? reject(error) : resolve());
    })
  };
}

async function runRealAppScenario(options) {
    const fixtureRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), 'effetune-rolling-real-app-')));
    const tracks = [
      path.join(fixtureRoot, 'strict-pcm16-stereo-one.wav'),
      path.join(fixtureRoot, 'strict-pcm16-stereo-two.wav')
    ];
    await Promise.all([
      writeFile(tracks[0], createStrictStereoWav(8_000)),
      writeFile(tracks[1], createStrictStereoWav(20_000))
    ]);
    const fixtureServer = await startFixtureServer();
    let application = null;
    try {
      application = await electron.launch({
        args: [
          `--user-data-dir=${path.join(fixtureRoot, 'profile')}`,
          path.join(repoRoot, 'tests', 'esm', 'rolling-pcm-real-app-electron-main.cjs')
        ],
        env: {
          ...process.env,
          ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
          EFFETUNE_ROLLING_REAL_APP_TEST_URL: fixtureServer.url,
          EFFETUNE_ROLLING_REAL_APP_TRACKS: JSON.stringify(tracks)
        },
        timeout: 20_000
      });
      const page = await application.firstWindow();
      const result = await page.evaluate(async options => {
        const [
          { AudioPlayer },
          { ElectronLibraryServiceClient },
          { CatalogPlaybackBridge },
          policy,
          { normalizeActivationIntentDescriptor }
        ] = await Promise.all([
          import('/js/ui/audio-player.js'),
          import('/js/library/operations/electron-library-service-client.js'),
          import('/js/ui/audio-player/catalog-playback-bridge.js'),
          import('/js/ui/audio-player/rolling-pcm-policy.js'),
          import('/js/audio/audio-activation-coordinator.js')
        ]);
        const waitFor = async (predicate, timeoutMs = 20_000) => {
          const deadline = performance.now() + timeoutMs;
          while (!predicate()) {
            if (performance.now() > deadline) throw new Error('state wait timed out');
            await new Promise(resolve => setTimeout(resolve, 25));
          }
        };
        const context = new AudioContext({ sampleRate: 96_000, sinkId: { type: 'none' } });
        if (context.sampleRate !== 96_000 || context.sinkId?.type !== 'none') {
          throw new Error('Electron 44 silent 96 kHz AudioContext is unavailable');
        }
        await context.audioWorklet.addModule('/tests/rolling-real-app-capture-worklet.js');
        const capture = new AudioWorkletNode(context, 'rolling-real-app-capture', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [2],
          channelCount: 2,
          channelCountMode: 'explicit'
        });
        capture.connect(context.destination);
        let summary = null;
        capture.port.onmessage = event => { if (event.data?.type === 'summary') summary = event.data; };
        const connectedSources = new Set();
        const silentSource = context.createConstantSource();
        silentSource.offset.value = 0;
        silentSource.start();
        const audioManager = {
          audioContext: context,
          sourceNode: silentSource,
          workletNode: capture,
          ioManager: {
            sourceNode: silentSource,
            ensureSilentSourceFallback: () => silentSource
          },
          connectSourceToPipeline(source) {
            if (!connectedSources.has(source)) {
              source.connect(capture);
              connectedSources.add(source);
            }
            return true;
          },
          disconnectSourceFromPipeline(source) {
            if (!connectedSources.delete(source)) return false;
            try { source.disconnect(capture); } catch (_) { /* already disconnected */ }
            return true;
          },
          ensureSourceConnectedToPipeline(source) {
            return this.connectSourceToPipeline(source);
          },
          isSourceConnectedToPipeline(source) {
            return connectedSources.has(source);
          }
        };
        audioManager.connectSourceToPipeline(silentSource);
        const staged = {
          enabled: options.stagedActivation === true,
          sequence: 0,
          current: null,
          stages: 0,
          commits: 0,
          rejected: 0,
          hold: null,
          holding: false
        };
        if (staged.enabled) {
          // Minimal production-shaped staged activation: the candidate stays private
          // across a render quantum, freshness is re-checked, then commit runs synchronously.
          // The intent goes through the coordinator's own descriptor validation so a
          // backend the coordinator rejects (as production `stageIntent` would) fails
          // here too instead of being accepted by the stub.
          audioManager.isStagedAudioActivationEnabled = () => true;
          audioManager.stageAudioActivation = async intent => {
            const descriptor = normalizeActivationIntentDescriptor(intent);
            staged.stages++;
            staged.current = { generation: ++staged.sequence, intent, descriptor };
            return staged.current;
          };
          audioManager.activateStagedAudioCandidate = async (stage, callbacks) => {
            const candidate = await callbacks.acquire(stage);
            let error = null;
            try {
              if (staged.hold) {
                staged.holding = true;
                try { await staged.hold; } finally { staged.holding = false; }
              }
              await new Promise(resolve => setTimeout(resolve, 40));
              if (staged.current !== stage) throw new Error('stage-superseded');
              if (callbacks.isCandidateCurrent?.(candidate, stage) === false) throw new Error('candidate-stale');
              const value = callbacks.commit?.(candidate, stage);
              staged.commits++;
              return { activated: true, stage, value };
            } catch (caught) {
              error = caught;
            }
            staged.rejected++;
            await callbacks.cleanup?.(candidate, stage, error);
            return { activated: false, stage, error };
          };
        }
        const stagedStats = () => ({
          enabled: staged.enabled,
          stages: staged.stages,
          commits: staged.commits,
          rejected: staged.rejected
        });
        window.electronIntegration = {
          isElectron: true,
          isElectronEnvironment: () => true,
          audioPreferences: { useInputWithPlayer: false, gaplessPlayback: true }
        };
        window.audioPreferences = { useInputWithPlayer: false, gaplessPlayback: true };
        window.uiManager = { audioPlayer: null, showTransientMessage() {}, setError() {} };
        const player = new AudioPlayer(audioManager);
        player.ui.container = document.createElement('div');
        window.uiManager.audioPlayer = player;
        await player.stateRestored;
        const service = new ElectronLibraryServiceClient();
        const bridge = new CatalogPlaybackBridge({ uiManager: window.uiManager, service, runtime: 'electron' });
        let commitCount = 0;
        const commitCatalogDestination = player.playbackManager.commitCatalogDestination.bind(player.playbackManager);
        player.playbackManager.commitCatalogDestination = async (...args) => {
          commitCount++;
          return commitCatalogDestination(...args);
        };
        const productionEvidence = policy.PRODUCTION_ROLLING_SELECTION_EVIDENCE_RECORD;
        if (policy.PRODUCTION_ROLLING_POLICY_MODE !== policy.RollingPolicyMode.LIMITED_ROLLING ||
            policy.PRODUCTION_ROLLING_ENABLED_MATRIX.length !== 1 ||
            productionEvidence.continuityPassed !== true ||
            productionEvidence.fullDecodeBaselineImprovementPassed !== true ||
            productionEvidence.warmupPlateauPassed !== true ||
            productionEvidence.cleanupReleased !== true ||
            productionEvidence.processMemory?.allGatesPassed !== true) {
          throw new Error('Production rolling evidence is fail-closed; real owner integration remains intentionally blocked');
        }
        if (player.contextManager.rollingPolicyMode !== policy.PRODUCTION_ROLLING_POLICY_MODE ||
            player.contextManager.rollingEnabledMatrix !== policy.PRODUCTION_ROLLING_ENABLED_MATRIX) {
          throw new Error('AudioContextManager is not using the production rolling defaults');
        }
        const cell = policy.PRODUCTION_ROLLING_ENABLED_MATRIX[0];
        if (cell.host !== 'electron' || cell.electronMajorVersion !== 44 ||
            cell.chromiumMajorVersion !== 152 || cell.sourceKind !== 'path' ||
            cell.format !== 'wav' || cell.sourceSampleRate !== 44_100 ||
            cell.outputSampleRate !== 96_000 || cell.channelCount !== 2) {
          throw new Error('Production rolling matrix is not the exact Electron 44 PCM16 44.1-to-96 cell');
        }
        const teardown = async () => {
          await player.stop();
          await player.contextManager.waitForRollingCleanupBarrier();
          bridge.close();
          capture.disconnect();
          audioManager.disconnectSourceFromPipeline(silentSource);
          silentSource.stop();
          silentSource.disconnect();
          await context.close();
        };
        const positionSnapshot = () => {
          const snapshot = player.stateManager.getStateSnapshot();
          return {
            isPlaying: snapshot.isPlaying,
            isPaused: snapshot.isPaused,
            position: snapshot.currentTrackPosition
          };
        };
        if (options.seekDuringStaging) {
          // Play is staged while paused, then a seek lands inside the staging window:
          // both intents survive, so playback ends up running from the adopted position.
          const receipt = await bridge.start({ operationKind: 'play', selectionDescriptor: { kind: 'fixture' } });
          await waitFor(() => player.stateManager.getStateSnapshot()?.playbackMode === 'rollingPcm' &&
            player.contextManager.rollingTransport?.playing === true);
          const transport = player.contextManager.rollingTransport;
          await player.contextManager.pause();
          await waitFor(() => transport.playing === false &&
            player.stateManager.getStateSnapshot()?.isPaused === true);
          const pausedPosition = transport.currentTime;
          let releaseHold = null;
          staged.hold = new Promise(resolve => { releaseHold = resolve; });
          const playing = player.contextManager.play();
          await waitFor(() => staged.holding === true);
          const seekTarget = 2;
          await player.contextManager.seek(seekTarget);
          const afterSeek = positionSnapshot();
          const transportAfterSeek = player.contextManager.rollingTransport;
          const transportPositionAfterSeek = transportAfterSeek.currentTime;
          staged.hold = null;
          releaseHold();
          const playResult = await playing;
          const afterActivation = positionSnapshot();
          const activatedPlaying = transportAfterSeek.playing;
          const activatedFrom = transportAfterSeek.currentTime;
          await teardown();
          return {
            receipt,
            sameTransport: transportAfterSeek === transport,
            pausedPosition,
            seekTarget,
            afterSeek,
            transportPositionAfterSeek,
            playResult,
            afterActivation,
            activatedPlaying,
            activatedFrom,
            staged: stagedStats(),
            liveManagerTransports: player.contextManager.rollingTransports.size
          };
        }
        const receipt = await bridge.start({ operationKind: 'play', selectionDescriptor: { kind: 'fixture' } });
        await waitFor(() => player.stateManager.getStateSnapshot()?.playbackMode === 'rollingPcm' &&
          player.contextManager.rollingTransport?.playing === true);
        const firstTransport = player.contextManager.rollingTransport;
        capture.port.postMessage({ type: 'start' });
        await player.contextManager.seek(1.5);
        await waitFor(() => player.contextManager.rollingTransport === firstTransport &&
          player.contextManager.rollingTransport?.currentTime >= 1.49);
        await waitFor(() => player.contextManager.nextRollingTransport?.rollingTransport?.prepared === true);
        const nextTransport = player.contextManager.nextRollingTransport.rollingTransport;
        await waitFor(() => player.stateManager.getStateSnapshot()?.currentTrackIndex === 1 &&
          player.contextManager.rollingTransport === nextTransport && commitCount === 1, 30_000);
        // Main-thread ownership moves before the boundary is audible; let the
        // audible clock pass the next anchor so a late next-track start is
        // captured instead of being cut off by the stop.
        const nextAnchorContextTime = nextTransport.anchorContextTime;
        await waitFor(() => context.currentTime >= nextAnchorContextTime + 0.2, 10_000);
        const captureStopContextTime = context.currentTime;
        capture.port.postMessage({ type: 'stop' });
        await waitFor(() => summary !== null);
        const observedTransports = [firstTransport, nextTransport, player.contextManager.rollingTransport];
        const managedSourceHandoff = audioManager.sourceNode === nextTransport.sourceNode ||
          audioManager.sourceNode === player.contextManager.getPipelineSourceNode(nextTransport.sourceNode);
        await player.stop();
        await player.contextManager.waitForRollingCleanupBarrier();
        const cleanup = observedTransports.map(transport => transport.getDiagnosticSnapshot());
        bridge.close();
        capture.disconnect();
        audioManager.disconnectSourceFromPipeline(silentSource);
        silentSource.stop();
        silentSource.disconnect();
        await context.close();
        return {
          receipt,
          state: player.stateManager.getStateSnapshot(),
          commitCount,
          summary,
          contextTime: captureStopContextTime,
          nextAnchorContextTime,
          managedSourceHandoff,
          cleanup,
          staged: stagedStats(),
          liveManagerTransports: player.contextManager.rollingTransports.size,
          scheduledRollingTransition: player.contextManager.scheduledRollingTransition
        };
      }, options);
      const versions = await application.evaluate(() => ({
        electron: process.versions.electron,
        chromium: process.versions.chrome,
        observations: global.rollingRealAppFixtureObservations
      }));
      return { result, versions, tracks };
    } finally {
      await application?.close().catch(() => {});
      await fixtureServer.close();
      await rm(fixtureRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
}

function assertOwnerPipeline({ result, versions, tracks }) {
  assert.match(versions.electron, /^44\./);
  assert.match(versions.chromium, /^152\./);
  assert.equal(result.receipt.kind, 'started');
  assert.equal(result.commitCount, 1);
  assert.equal(result.managedSourceHandoff, true);
  const captureDetail = JSON.stringify({
    summary: result.summary,
    contextTime: result.contextTime,
    nextAnchorContextTime: result.nextAnchorContextTime
  });
  // Continuity is asserted from the audio content itself: every rendered block carried
  // strictly non-zero, finite samples from one of the two tracks and no block after the
  // start was empty. missingBlocks / duplicateBlocks are render-clock diagnostics kept
  // in captureDetail only (see the capture worklet).
  const { missingBlocks, duplicateBlocks, ...assertedSummary } = result.summary;
  assert.equal(typeof missingBlocks, 'number', `capture ${captureDetail}`);
  assert.equal(typeof duplicateBlocks, 'number', `capture ${captureDetail}`);
  assert.deepEqual(assertedSummary, {
    type: 'summary',
    seenBlocks: result.summary.seenBlocks,
    nonFinite: 0,
    unexpectedZero: 0,
    trackOneBlocks: result.summary.trackOneBlocks,
    trackTwoBlocks: result.summary.trackTwoBlocks,
    emptyBlocksAfterStart: 0
  }, `capture ${captureDetail}`);
  assert.equal(result.summary.seenBlocks, result.summary.trackOneBlocks + result.summary.trackTwoBlocks,
    `capture ${captureDetail}`);
  assert.ok(result.summary.seenBlocks > 0 && result.summary.trackOneBlocks > 0 && result.summary.trackTwoBlocks > 0,
    `capture ${captureDetail}`);
  assert.ok(result.contextTime >= result.nextAnchorContextTime + 0.2, `capture ${captureDetail}`);
  assert.equal(result.liveManagerTransports, 0);
  assert.equal(result.scheduledRollingTransition, null);
  for (const snapshot of result.cleanup) {
    assert.equal(snapshot.liveWorkers, 0);
    assert.equal(snapshot.liveSourceNodes, 0);
    assert.equal(snapshot.liveAudioBuffers, 0);
    assert.equal(snapshot.liveHandlers, 0);
    assert.equal(snapshot.liveTimers, 0);
  }
  assert.equal(versions.observations.starts, 1);
  assert.ok(versions.observations.sourceResolutions.filter(value => value === tracks[0]).length >= 1);
  assert.ok(versions.observations.sourceResolutions.includes(tracks[1]));
  assert.ok(versions.observations.boundedReads.filter(value => value.filePath === tracks[0]).length >= 2,
    'mid-track seek must reacquire the canonical first path through bounded IPC');
  assert.ok(versions.observations.boundedReads.some(value => value.filePath === tracks[1]));
}

test('real Electron catalog playback follows the production rolling owner pipeline',
  { timeout: 120_000 }, async () => {
    const scenario = await runRealAppScenario({ stagedActivation: false });
    assertOwnerPipeline(scenario);
    assert.deepEqual(scenario.result.staged, { enabled: false, stages: 0, commits: 0, rejected: 0 });
  });

test('real Electron catalog playback follows the owner pipeline through staged activation',
  { timeout: 120_000 }, async () => {
    const scenario = await runRealAppScenario({ stagedActivation: true });
    assertOwnerPipeline(scenario);
    assert.equal(scenario.result.staged.enabled, true);
    assert.ok(scenario.result.staged.stages >= 1);
    assert.equal(scenario.result.staged.commits, scenario.result.staged.stages);
    assert.equal(scenario.result.staged.rejected, 0);
  });

test('a seek inside the staged Play window commits playback at the adopted position',
  { timeout: 120_000 }, async () => {
    const { result } = await runRealAppScenario({ stagedActivation: true, seekDuringStaging: true });
    assert.equal(result.receipt.kind, 'started');
    assert.equal(result.sameTransport, true);
    assert.ok(result.pausedPosition < result.seekTarget - 0.5, `paused at ${result.pausedPosition}`);
    assert.equal(result.afterSeek.isPlaying, false);
    assert.equal(result.afterSeek.isPaused, true);
    assert.ok(Math.abs(result.afterSeek.position - result.seekTarget) < 0.02, `seek state ${result.afterSeek.position}`);
    assert.ok(Math.abs(result.transportPositionAfterSeek - result.seekTarget) < 0.02,
      `transport ${result.transportPositionAfterSeek}`);
    assert.equal(result.playResult, true);
    assert.equal(result.activatedPlaying, true);
    assert.equal(result.afterActivation.isPlaying, true);
    assert.equal(result.afterActivation.isPaused, false);
    assert.ok(Math.abs(result.afterActivation.position - result.seekTarget) < 0.02,
      `staged Play anchored at ${result.afterActivation.position} instead of the adopted position`);
    assert.ok(result.activatedFrom >= result.seekTarget - 0.02 && result.activatedFrom < result.seekTarget + 0.5,
      `playing from ${result.activatedFrom}`);
    assert.deepEqual(result.staged, { enabled: true, stages: 2, commits: 2, rejected: 0 });
    assert.equal(result.liveManagerTransports, 0);
  });
