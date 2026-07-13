import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { POWER_SNAPSHOT_SCHEMA_VERSION } from '../../js/audio/power-snapshot.js';

const packageJson = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
);
const escapedAppVersion = String(packageJson.version)
  .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const POLICY_DEADLINES_MS = Object.freeze({
  continuous: 30_000,
  balanced: 15_000,
  maximum: 3_000
});

async function runScenario(page, options) {
  return page.evaluate(async scenarioOptions => {
    if (!window.__powerPolicySmoke?.ready) {
      throw new Error('Power policy fixture API is not ready.');
    }
    return window.__powerPolicySmoke.runPlayerOnlyScenario(scenarioOptions);
  }, options);
}

function assertRetainedMicScenario(
  result,
  expectedState,
  label,
  { inputSignalReason = 'not-routed' } = {}
) {
  assert.equal(result.targetState, expectedState, `${label}: target state`);
  assert.equal(result.inputSignalForProcessing, 'silent', `${label}: routed signal`);
  assert.equal(result.inputSignalReason, inputSignalReason, `${label}: routed signal reason`);
  assert.equal(result.inputRetentionTarget, true, `${label}: input retention target`);
  assert.equal(result.shouldReleaseInput, false, `${label}: input release decision`);
  assert.equal(result.trackReadyState, 'live', `${label}: mic readyState`);
  assert.equal(result.trackStopCalls, 0, `${label}: mic stop calls`);
  assert.equal(result.inputReleaseCalls, 0, `${label}: input release executor calls`);
}

function assertNoSyntheticRuntimeCounters(result, label) {
  assert.equal('fullDspCalls' in result, false, `${label}: no synthesized DSP counter`);
  assert.equal('visualizationFrames' in result, false, `${label}: no synthesized UI counter`);
}

function assertActualAudioGraph(evidence, label) {
  assert.deepEqual(evidence.runtimeNodes, {
    worklet: 'AudioWorkletNode',
    inputSource: 'MediaStreamAudioSourceNode',
    routeGate: 'GainNode',
    inputTrackReadyState: 'live'
  }, `${label}: actual fake-mic AudioWorklet graph`);
}

function assertMonitoringWorkletEvidence(result, label, { suspended = false } = {}) {
  const evidence = result.workletEvidence;
  assert.ok(evidence, `${label}: real AudioWorklet evidence`);
  assertActualAudioGraph(evidence, label);
  assert.equal(evidence.configured, true, `${label}: worklet configured`);
  assert.equal(evidence.appliedDirective, 'force-monitoring', `${label}: applied directive`);
  assert.equal(evidence.appliedState, 'monitoring', `${label}: applied worklet state`);
  assert.equal(evidence.after.processingDirective, 'force-monitoring', `${label}: observed directive`);
  assert.equal(evidence.after.state, 'monitoring', `${label}: observed worklet state`);
  assert.ok(evidence.runningDelta.renderQuanta > 0, `${label}: real render delta`);
  assert.equal(
    evidence.runningDelta.detectorQuanta,
    evidence.runningDelta.renderQuanta,
    `${label}: detector covers every render quantum`
  );
  assert.ok(evidence.runningDelta.monitoringQuanta > 0, `${label}: monitoring quantum delta`);
  assert.equal(evidence.runningDelta.fullProcessQuanta, 0, `${label}: no full DSP quanta`);
  assert.equal(evidence.runningDelta.fullJsProcessQuanta, 0, `${label}: no JavaScript DSP quanta`);
  assert.equal(evidence.runningDelta.fullWasmProcessQuanta, 0, `${label}: no WASM DSP quanta`);
  assert.equal(evidence.runningDelta.telemetryReads, 0, `${label}: no DSP telemetry reads`);
  assert.equal(evidence.runningDelta.telemetryPosts, 0, `${label}: no DSP telemetry posts`);
  assert.equal(evidence.runningDelta.monitoringRuntimeFailures, 0, `${label}: safe monitoring`);
  assertNoSyntheticRuntimeCounters(result, label);

  if (suspended) {
    assert.equal(evidence.suspension?.state, 'suspended', `${label}: actual context suspension`);
    assert.equal(
      evidence.suspension?.noRenderMessageWhileSuspended,
      true,
      `${label}: observation remains pending while suspended`
    );
    assert.ok(
      evidence.suspension.firstResumedRenderSequence >
        evidence.suspension.renderSequenceBeforeSuspend,
      `${label}: pending observation completes on resumed render`
    );
  } else {
    assert.equal(evidence.suspension, null, `${label}: context remains running`);
  }
}

function assertFullProcessWorkletEvidence(result, label, { unsafeProbe = false } = {}) {
  const evidence = result.workletEvidence;
  assert.ok(evidence, `${label}: real AudioWorklet evidence`);
  assertActualAudioGraph(evidence, label);
  if (unsafeProbe) {
    assert.deepEqual(evidence.unsafeMonitoringProbe, {
      requestedDirective: 'force-monitoring',
      appliedDirective: 'full-process',
      appliedState: 'active'
    }, `${label}: unsafe monitoring rejected by worklet`);
  } else {
    assert.equal(evidence.unsafeMonitoringProbe, null, `${label}: no unsafe monitoring probe`);
  }
  assert.equal(evidence.appliedDirective, 'full-process', `${label}: full processing applied`);
  assert.equal(evidence.appliedState, 'active', `${label}: active worklet state`);
  assert.ok(evidence.runningDelta.renderQuanta > 0, `${label}: real render delta`);
  assert.equal(
    evidence.runningDelta.detectorQuanta,
    evidence.runningDelta.renderQuanta,
    `${label}: detector covers every render quantum`
  );
  assert.ok(evidence.runningDelta.fullProcessQuanta > 0, `${label}: full DSP quantum delta`);
  assert.equal(
    evidence.runningDelta.fullJsProcessQuanta,
    evidence.runningDelta.fullProcessQuanta,
    `${label}: registered JavaScript plugin runs for every full quantum`
  );
  assert.equal(evidence.runningDelta.fullWasmProcessQuanta, 0, `${label}: no WASM path`);
  assert.equal(evidence.runningDelta.monitoringQuanta, 0, `${label}: no monitoring quanta`);
  assert.equal(evidence.runningDelta.telemetryReads, 0, `${label}: no DSP telemetry reads`);
  assert.equal(evidence.runningDelta.telemetryPosts, 0, `${label}: no DSP telemetry posts`);
  assert.equal(evidence.runningDelta.monitoringRuntimeFailures, 0, `${label}: no runtime fallback`);
  assertNoSyntheticRuntimeCounters(result, label);
}

async function openFixturePage(context, baseURL, browserErrors) {
  const page = await context.newPage();
  page.on('pageerror', error => browserErrors.push(error.stack || error.message));
  page.on('console', message => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  await page.goto(`${baseURL}/__power-policy-smoke__/index.html?powerPolicy=1`, {
    waitUntil: 'domcontentloaded'
  });
  await page.waitForFunction(() => window.__powerPolicySmoke?.ready === true);
  return page;
}

export async function runPowerPolicyBrowserSmoke({ browser, baseURL }) {
  const context = await browser.newContext();
  await context.grantPermissions(['microphone'], { origin: baseURL });
  const browserErrors = [];
  const page = await openFixturePage(context, baseURL, browserErrors);

  try {
    for (const [mode, deadlineMs] of Object.entries(POLICY_DEADLINES_MS)) {
      for (const playerState of ['paused', 'stopped']) {
        const label = `${mode}/${playerState}`;
        const before = await runScenario(page, {
          mode,
          playerState,
          routeIntent: 'none',
          visibility: 'visible',
          noRouteElapsedMs: deadlineMs - 1,
          inputUnusedElapsedMs: deadlineMs - 1,
          fullSuspendDelaySeconds: 60,
          mustProcess: false,
          applyInputRelease: false
        });
        assertRetainedMicScenario(before, 'ACTIVE', `${label}/before`);
        assert.equal(before.processingDirective, 'full-process');
        assert.equal(before.contextState, 'running');
        assert.equal(before.contextSuspendCalls, 0);
        assertFullProcessWorkletEvidence(before, `${label}/before`);

        const exact = await runScenario(page, {
          mode,
          playerState,
          routeIntent: 'none',
          visibility: 'hidden',
          noRouteElapsedMs: deadlineMs,
          inputUnusedElapsedMs: deadlineMs,
          fullSuspendDelaySeconds: 60,
          mustProcess: false,
          applyInputRelease: false
        });
        assertRetainedMicScenario(exact, 'SUSPENDED', `${label}/exact`);
        assert.equal(exact.processingDirective, 'suspended');
        assert.equal(exact.contextState, 'suspended');
        assert.equal(exact.contextSuspendCalls, 1);
        assertMonitoringWorkletEvidence(exact, `${label}/exact`, { suspended: true });
      }
    }

    for (const playerState of ['paused', 'stopped']) {
      const mustProcess = await runScenario(page, {
        mode: 'maximum',
        playerState,
        routeIntent: 'none',
        visibility: 'hidden',
        noRouteElapsedMs: POLICY_DEADLINES_MS.maximum,
        inputUnusedElapsedMs: POLICY_DEADLINES_MS.maximum,
        fullSuspendDelaySeconds: 60,
        mustProcess: true,
        applyInputRelease: false
      });
      assertRetainedMicScenario(mustProcess, 'ACTIVE', `must-process/${playerState}`);
      assert.equal(mustProcess.processingDirective, 'full-process');
      assert.equal(mustProcess.contextState, 'running');
      assert.equal(mustProcess.contextSuspendCalls, 0);
      assertFullProcessWorkletEvidence(mustProcess, `must-process/${playerState}`, {
        unsafeProbe: true
      });
    }

    for (const playerState of ['paused', 'stopped']) {
      const contextDeadline = await runScenario(page, {
        mode: 'maximum',
        playerState,
        routeIntent: 'none',
        visibility: 'hidden',
        noRouteElapsedMs: POLICY_DEADLINES_MS.maximum,
        inputUnusedElapsedMs: POLICY_DEADLINES_MS.maximum,
        fullSuspendDelaySeconds: 60,
        mustProcess: false,
        applyInputRelease: false
      });
      assertRetainedMicScenario(
        contextDeadline,
        'SUSPENDED',
        `maximum-split/${playerState}/context`
      );
      assert.equal(contextDeadline.contextSuspendCalls, 1);
      assertMonitoringWorkletEvidence(
        contextDeadline,
        `maximum-split/${playerState}/context`,
        { suspended: true }
      );

      const inputDeadline = await runScenario(page, {
        mode: 'maximum',
        playerState,
        visibility: 'hidden',
        noRouteElapsedMs: POLICY_DEADLINES_MS.maximum,
        inputUnusedElapsedMs: 60_000,
        fullSuspendDelaySeconds: 60,
        mustProcess: false,
        applyInputRelease: true
      });
      assert.equal(inputDeadline.targetState, 'ACTIVE');
      assert.equal(inputDeadline.processingDirective, 'full-process');
      assert.equal(inputDeadline.contextState, 'running');
      assert.equal(inputDeadline.contextSuspendCalls, 0);
      assert.equal(inputDeadline.inputRetentionTarget, false);
      assert.equal(inputDeadline.shouldReleaseInput, true);
      assert.equal(inputDeadline.releaseCause, 'player-only-retention-expired');
      assert.equal(inputDeadline.manualResumeRequired, true);
      assert.equal(inputDeadline.inputReleaseCalls, 1);
      assert.equal(inputDeadline.trackStopCalls, 1);
      assert.equal(inputDeadline.trackReadyState, 'ended');
      assertFullProcessWorkletEvidence(
        inputDeadline,
        `maximum-split/${playerState}/input`
      );
    }

    const probeEnablement = options => page.evaluate(probeOptions =>
      window.__powerPolicySmoke.probeControllerEnablement(probeOptions), options);
    assert.equal(
      (await probeEnablement({})).enabled,
      true,
      'controller enabled by default when proof capabilities exist'
    );
    assert.equal(
      (await probeEnablement({ search: '?powerPolicy=1' })).enabled,
      true,
      'controller enabled by explicit ?powerPolicy=1'
    );
    assert.equal(
      (await probeEnablement({ search: '?powerPolicy=0' })).enabled,
      false,
      'controller disabled by explicit ?powerPolicy=0 opt-out'
    );
    assert.equal(
      (await probeEnablement({ powerPolicyEnabled: true })).enabled,
      true,
      'controller enabled by appConfig.powerPolicyEnabled=true'
    );
    assert.equal(
      (await probeEnablement({ powerPolicyEnabled: false })).enabled,
      false,
      'controller disabled by appConfig.powerPolicyEnabled=false'
    );
    assert.equal(
      (await probeEnablement({ search: '?powerPolicy=0', powerPolicyEnabled: true })).enabled,
      false,
      'query opt-out overrides config opt-in'
    );
    assert.equal(
      (await probeEnablement({ search: '?powerPolicy=1', powerPolicyEnabled: false })).enabled,
      true,
      'query opt-in overrides config opt-out'
    );

    const serviceWorkerEvidence = await page.evaluate(() =>
      window.__powerPolicySmoke.verifyServiceWorkerPrecache());
    assert.equal(serviceWorkerEvidence.supported, true);
    assert.match(
      serviceWorkerEvidence.oldWorkerScript,
      /\/__power-policy-smoke__\/old-sw\.js$/
    );
    assert.match(serviceWorkerEvidence.activeWorkerScript, /\/sw\.js$/);
    assert.match(
      serviceWorkerEvidence.cacheVersion,
      new RegExp(`^effetune-v${escapedAppVersion}-`)
    );
    assert.equal(serviceWorkerEvidence.oldCacheRemoved, true);
    assert.equal(serviceWorkerEvidence.workletPrecached, true);
    assert.equal(serviceWorkerEvidence.snapshotPrecached, true);
    assert.equal(
      serviceWorkerEvidence.snapshotSchemaVersion,
      POWER_SNAPSHOT_SCHEMA_VERSION
    );

    assert.deepEqual(browserErrors, []);
  } finally {
    await page.evaluate(() => window.__powerPolicySmoke?.dispose()).catch(() => {});
    await context.close();
  }
}
