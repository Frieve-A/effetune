import assert from 'node:assert/strict';

const FIXTURE_PATH = '/tests/browser/mp3-resume-wasm-smoke.fixture.html';

// The MP3 wet path is under active revision, so this smoke asserts behaviour only: routing, the
// reset-on-resume contract, state divergence and finiteness. It never pins wet audio content.
export async function runMp3ResumeWasmBrowserSmoke({ browser, baseURL }) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const browserErrors = [];
  page.on('pageerror', error => browserErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  try {
    await page.goto(`${baseURL}${FIXTURE_PATH}`, { waitUntil: 'load' });
    const result = await page.evaluate(() => window.__mp3ResumeWasmSmoke.run());
    assert.equal(result.pluginType, 'MP3CodecSimulatorPlugin');
    assert.equal(result.actualSampleRate, 48000);
    assert.equal(result.suspendedState, 'suspended');
    assert.equal(result.resumedState, 'running');
    assert.equal(result.protocol, 'prepareTemporalStateAndResume');
    assert.equal(result.continuedReference, 'full-process-preserved-state');
    assert.equal(result.resetAckState, 'acknowledged');
    assert.equal(result.resetPolicyCount, 1);
    assert.equal(result.resetCoveredPluginCount, 1);
    assert.equal(result.freshAckState, 'acknowledged');
    assert.equal(result.freshPolicyCount, 1);
    assert.equal(result.paramPackerSource, 'production-generated');
    assert.equal(result.paramPackerFloatCount, 6);
    assert.equal(result.paramHashMatchesArtifact, true);
    assert.ok(result.productionKernelCount > 0);
    assert.equal(result.primedWhileSourceActive, true);
    // Reset-on-resume honored: the resumed instance is indistinguishable from a fresh one.
    assert.equal(result.exactResetMatches, result.sampleCount);
    // No stale audio survives: the instance that kept its granule FIFO and bit reservoir does
    // diverge from the fresh one, which proves the reset above is a real state change.
    assert.ok(result.continuedDifferences > 0);
    assert.equal(result.finiteSamples, result.sampleCount);
    assert.ok(result.nonZeroSamples > 0);
    assert.deepEqual(browserErrors, []);
  } finally {
    await page.close();
    await context.close();
  }
}
