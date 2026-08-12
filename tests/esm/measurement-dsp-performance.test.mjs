import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import test from 'node:test';

import { resampleWindowedSinc } from '../../js/utils/measurement-dsp/resample.js';

test('cold resampling of four full-size measurement points stays within the design budget', {
    timeout: 10000
}, () => {
    const points = Array.from({ length: 4 }, (_, pointIndex) => {
        const input = new Float32Array(262144);
        input[4096 + pointIndex] = 1;
        return input;
    });
    const startedAt = performance.now();
    const outputs = points.map(input => resampleWindowedSinc(input, 192000, 44100));
    const durationMs = performance.now() - startedAt;

    assert.ok(outputs.every(output => output.length === Math.round(262144 * 44100 / 192000)));
    assert.ok(durationMs < 4000, `four-point cold resampling took ${durationMs.toFixed(1)} ms`);
});
