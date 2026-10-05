import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { SpectrumTapContract as contract } from '../js/audio/visual-sync.js';
import { loadOverlay } from '../tests/helpers/spectrum-overlay-harness.mjs';

const runner = process.argv[2];
assert.ok(runner, 'Pass the compiled effetune_dsp_spectrum_tap_tests executable');
const actual = JSON.parse(execFileSync(runner, ['--export'], { encoding: 'utf8',
  maxBuffer: 1024 * 1024, windowsHide: true }));
const overlay = loadOverlay();
const sandbox = {};
vm.runInNewContext(fs.readFileSync(new URL('../plugins/multires-spectrum.js', import.meta.url), 'utf8'), sandbox);
for (const frame of actual) {
  const { quality, sampleRate: rate, timing } = frame;
  assert.equal(contract.valid(timing), true);
  assert.deepEqual({ windowAgeFrames: timing.windowAgeFrames, completionFrames: timing.completionFrames },
    contract.profile(quality, rate));
  const sample = index => index < 64 ? 0 : Math.sin(2 * Math.PI * 1000 * (index - 64) / rate);
  let expected, captureEnd;
  if (quality === 'normal') {
    const end = timing.captureEndFrame - 48000;
    const input = Float32Array.from({ length: 4096 }, (_, i) => sample(end - 4096 + i));
    expected = { current: overlay.analyze(input, 0, rate) };
    captureEnd = end;
  } else {
    const analyzer = new sandbox.MultiresSpectrum(rate, 4);
    for (let offset = 0; offset < 48000; offset += 256) {
      const block = Float32Array.from({ length: Math.min(256, 48000 - offset) }, (_, i) => sample(offset + i));
      const raw = analyzer.process(block, { pt: 12, hq: true, dr: -96,
        channelCount: 1, blockSize: block.length });
      if (raw) { expected = sandbox.MultiresSpectrum.decode(raw, 4); analyzer.release(raw); }
    }
    captureEnd = expected.captureEndSample;
    assert.equal(frame.validCellCount, expected.validCellCount);
  }
  assert.equal(timing.captureEndFrame, captureEnd + 48000);
  for (let i = 0; i < frame.validCellCount; i++) {
    // Silence below the graph floor does not have meaningful relative precision.
    assert.ok(Math.abs(Math.max(-96, frame.input[i]) - Math.max(-96, expected.current[i])) < 0.02,
      `${quality} ${rate} input cell ${i}`);
    assert.ok(Math.abs(Math.max(-96, frame.output[i]) - Math.max(-96, expected.current[i] - 6.0206)) < 0.02,
      `${quality} ${rate} output cell ${i}`);
  }
}
console.log(`Spectrum Tap native/browser parity passed: ${actual.length} profiles, capture positions and timing v1.`);
