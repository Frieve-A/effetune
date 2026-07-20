import assert from 'node:assert/strict';

const FIXTURE_PATH = '/tests/browser/ir-reverb-wasm-smoke.fixture.html';

export async function runIrReverbWasmBrowserSmoke({ browser, baseURL }) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const browserErrors = [];
  page.on('pageerror', error => browserErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  try {
    await page.goto(`${baseURL}${FIXTURE_PATH}`, { waitUntil: 'load' });
    for (const artifact of ['effetune-dsp.wasm', 'effetune-dsp.simd.wasm']) {
      const result = await page.evaluate(({ selectedArtifact, powerTailGate }) =>
        window.__irReverbWasmSmoke.runWetCapture({
          artifact: selectedArtifact,
          powerTailGate
        }), { selectedArtifact: artifact, powerTailGate: artifact === 'effetune-dsp.wasm' });
      assert.equal(result.actualSampleRate, 96000, `${artifact}: actual AudioContext sample rate`);
      assert.equal(result.convolutionRateParameter, 'auto', `${artifact}: auto convolution rate`);
      assert.equal(result.resolvedRateDivider, 2, `${artifact}: auto resolves to D=2 at 96 kHz`);
      assert.equal(result.dspReady.hasIrKernel, true, `${artifact}: IR kernel capability`);
      assert.equal(result.dspReady.simd, artifact.includes('.simd.'), `${artifact}: selected WASM flavor`);
      assert.equal(result.assetState, 3, `${artifact}: committed IR asset is ACTIVE`);
      assert.ok(result.instanceEvidence.latencySamples > 0, `${artifact}: live IR instance latency`);
      assert.ok(result.instanceEvidence.wasmProcessQuanta > 0, `${artifact}: real WASM processing`);
      assert.equal(result.instanceEvidence.jsProcessQuanta, 0, `${artifact}: no JavaScript fallback`);
      assert.ok(result.wet.sampleCount > 0, `${artifact}: captured output`);
      assert.equal(result.wet.finite, true, `${artifact}: finite wet output`);
      assert.ok(result.wet.nonZeroSamples > 0, `${artifact}: non-zero wet samples`);
      assert.ok(result.wet.peak > 1e-5, `${artifact}: audible wet peak`);
      assert.equal(
        result.power.monitoringFastWakeEligible,
        true,
        `${artifact}: stateful IR can prepare routed fast monitoring`
      );

      for (const dryEnabled of [false, true]) {
        const missing = await page.evaluate(({ selectedArtifact, selectedDry }) =>
          window.__irReverbWasmSmoke.runWetCapture({
            artifact: selectedArtifact,
            assetPresent: false,
            dryEnabled: selectedDry
          }), { selectedArtifact: artifact, selectedDry: dryEnabled });
        assert.equal(missing.assetState, null, `${artifact}: missing IR has no committed asset`);
        assert.equal(missing.wet.finite, true, `${artifact}: missing IR output remains finite`);
        if (dryEnabled) {
          assert.ok(missing.wet.peak > 1e-5, `${artifact}: configured dry path remains audible`);
          assert.ok(missing.wet.nonZeroSamples > 0, `${artifact}: configured dry path has samples`);
        } else {
          assert.ok(missing.wet.peak <= 1e-7, `${artifact}: dry-disabled missing IR is silent`);
          assert.equal(missing.wet.nonZeroSamples, 0, `${artifact}: dry-disabled missing IR has no output samples`);
        }
      }
      assert.equal(
        result.power.monitoringFastWakeBlockerReason,
        null,
        `${artifact}: stateful monitoring has no static blocker`
      );
      assert.equal(result.power.tail.state, 'active', `${artifact}: tail keeps worklet active`);
      assert.equal(
        result.power.tail.processingDirective,
        'full-process',
        `${artifact}: tail retains full processing`
      );
      assert.equal(result.power.tail.outputActive, true, `${artifact}: tail is audibly active`);
      assert.ok(result.power.tail.wasmProcessQuanta > 0, `${artifact}: tail keeps full WASM processing`);
      assert.equal(result.power.tail.monitoringQuanta, 0, `${artifact}: tail is not monitored away`);
      if (artifact === 'effetune-dsp.wasm') {
        assert.equal(result.power.profile, 'mobile-balanced-equivalent');
        assert.equal(result.power.silenceThresholdDb, -80);
        assert.deepEqual(result.power.postTailTransition, {
          tailSilent: true,
          acceptedDirective: 'force-monitoring',
          state: 'monitoring',
          processingDirective: 'force-monitoring',
          contextState: 'suspended',
          monitoringQuanta: result.power.postTailTransition.monitoringQuanta
        });
        assert.ok(
          result.power.postTailTransition.monitoringQuanta > 0,
          `${artifact}: normal monitoring runs after the tail`
        );
      }

      for (const topologyCase of ['true', 'matrix']) {
        const topology = await page.evaluate(({ selectedArtifact, selectedTopology }) =>
          window.__irReverbWasmSmoke.runWetCapture({
            artifact: selectedArtifact,
            topologyCase: selectedTopology
          }), { selectedArtifact: artifact, selectedTopology: topologyCase });
        assert.equal(topology.assetState, 3, `${artifact}/${topologyCase}: asset ACTIVE`);
        assert.ok(topology.instanceEvidence.wasmProcessQuanta > 0,
          `${artifact}/${topologyCase}: real WASM processing`);
        assert.equal(topology.instanceEvidence.jsProcessQuanta, 0,
          `${artifact}/${topologyCase}: no JavaScript fallback`);
        assert.equal(topology.wet.finite, true, `${artifact}/${topologyCase}: finite output`);
        assert.ok(topology.wet.peaks[0] > 1e-5, `${artifact}/${topologyCase}: left route`);
        assert.ok(topology.wet.peaks[1] > 1e-5, `${artifact}/${topologyCase}: right route`);
        assert.ok(Math.abs(topology.wet.outputRatio - topology.wet.expectedOutputRatio) < 0.02,
          `${artifact}/${topologyCase}: analytical route ratio`);
      }
    }
    assert.deepEqual(browserErrors, []);
  } finally {
    await page.close();
    await context.close();
  }
}
