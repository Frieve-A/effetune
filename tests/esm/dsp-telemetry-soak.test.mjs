import assert from 'node:assert/strict';
import test from 'node:test';

import { runTelemetrySoak } from '../../tools/dsp-parity/telemetry-soak.mjs';

for (const variant of ['baseline', 'simd']) {
  test(`telemetry soak verifier checks ${variant} frame sequences and drops`, async () => {
    const result = await runTelemetrySoak({ variant, seconds: 1, log() {} });
    assert.equal(result.simulatedSeconds, 1);
    assert.equal(result.quantumCount, 1500);
    assert.equal(result.frameCount, 240);
    assert.equal(result.droppedFrames, 0);
  });
}
