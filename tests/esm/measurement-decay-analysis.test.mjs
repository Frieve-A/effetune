import assert from 'node:assert/strict';
import test from 'node:test';
import { Worker } from 'node:worker_threads';
import { analyzeBurstDecay } from '../../js/utils/measurement-dsp/analysis.js';

const tauCycles = Math.sqrt(2 * Math.log(2)) / (Math.PI * (2 ** (1 / 6) - 2 ** (-1 / 6)));

function impulse({ sampleRate = 48000, seconds = 1.5, onsetIndex = 96, gain = 1, refScale = 1 } = {}) {
    const data = new Float32Array(Math.ceil(seconds * sampleRate));
    data[onsetIndex] = gain;
    return { data, sampleRate, onsetIndex, refScale };
}

test('unit impulse burst starts at 0 dB and follows the known Gaussian with one shared reference', () => {
    const record = impulse({ gain: 0.25, refScale: 0.5 });
    const result = analyzeBurstDecay(record, { endCycles: 5, maxSlices: 6, maxFrequency: 10000 });
    for (const slice of result.slices) {
        const expected = 20 * Math.log10(0.5) - 20 / Math.LN10 * (slice.depth / tauCycles) ** 2;
        for (const level of slice.levels) assert.ok(Math.abs(level - expected) < 0.00001, `${slice.depth}: ${level} != ${expected}`);
    }
    const unit = analyzeBurstDecay(impulse({ onsetIndex: 0 }), { maxSlices: 2, endCycles: 1 });
    assert.ok(unit.slices[0].levels.every(level => Math.abs(level) < 1e-8));
    assert.equal(result.referenceDb, 0);
    assert.equal(result.bandwidthOctaves, 1 / 3);
});

test('cycles map to frequency-dependent time and preserve the same burst convolution', () => {
    const record = impulse();
    const cycles = analyzeBurstDecay(record, { minFrequency: 500, maxFrequency: 1000, endCycles: 5, maxSlices: 2 });
    for (const index of [0, cycles.frequencies.length - 1]) {
        const seconds = analyzeBurstDecay(record, {
            minFrequency: 500, maxFrequency: 1000, depthUnit: 'seconds',
            endSeconds: 5 / cycles.frequencies[index], maxSlices: 2
        });
        assert.ok(Math.abs(cycles.slices[1].levels[index] - seconds.slices[1].levels[index]) < 1e-9);
    }
});

test('equal-Q resonators have the analytical decay per cycle at different frequencies', () => {
    const q = 30;
    for (const frequency of [500, 1000]) {
        const record = impulse({ seconds: 0.2, onsetIndex: 0 });
        for (let n = 0; n < record.data.length; n++) {
            const phase = 2 * Math.PI * frequency * n / record.sampleRate;
            record.data[n] = 2 * Math.PI * frequency / record.sampleRate * Math.exp(-phase / (2 * q)) * Math.sin(phase);
        }
        const result = analyzeBurstDecay(record, {
            minFrequency: frequency, maxFrequency: frequency * 1.001,
            startCycles: 10, endCycles: 20, maxSlices: 3
        });
        const expectedDrop = -20 / Math.LN10 * Math.PI / q * 10;
        const actualDrop = result.slices[2].levels[0] - result.slices[0].levels[0];
        assert.ok(Math.abs(actualDrop - expectedDrop) < 0.00001, `${frequency}: ${actualDrop}`);
    }
});

test('stored pre-onset response contributes, while missing late support remains a gap', () => {
    const record = impulse({ seconds: 0.1, onsetIndex: 96 });
    record.data[48] = 0.3;
    const result = analyzeBurstDecay(record, { minFrequency: 100, maxFrequency: 1000, endCycles: 30, maxSlices: 2 });
    const frequency = result.frequencies[0];
    const dt = 48 / record.sampleRate;
    const amplitude = 0.3 * Math.exp(-((dt * frequency / tauCycles) ** 2));
    const expected = 20 * Math.log10(Math.hypot(1 + amplitude * Math.cos(2 * Math.PI * frequency * dt), amplitude * Math.sin(2 * Math.PI * frequency * dt)));
    assert.ok(Math.abs(result.slices[0].levels[0] - expected) < 1e-6);
    assert.equal(result.slices[1].levels[0], null);
    assert.ok(Number.isFinite(result.slices[1].levels.at(-1)));
    assert.throws(() => analyzeBurstDecay(record, { minFrequency: 10, maxFrequency: 20 }), /No observed/);
    assert.throws(() => analyzeBurstDecay(record, { depthUnit: 'invalid' }), /Invalid/);
    assert.throws(() => analyzeBurstDecay(record, { endCycles: Infinity }), /Invalid/);
    record.data[4] = NaN;
    assert.throws(() => analyzeBurstDecay(record), /Invalid impulse/);
});

test('high-rate burst meshes preserve resonances and useful frequency density within the work bound', () => {
    for (const sampleRate of [96000, 384000]) {
        const record = impulse({ sampleRate });
        const resonance = 1000;
        for (let n = record.onsetIndex; n < record.data.length; n++) {
            const phase = 2 * Math.PI * resonance * (n - record.onsetIndex) / sampleRate;
            record.data[n] = 2 * Math.PI * resonance / sampleRate * Math.exp(-phase / 60) * Math.sin(phase);
        }
        const result = analyzeBurstDecay(record);
        assert.ok(result.evaluatedSamples <= 256_000_000);
        assert.equal(result.frequencies.length, 96);
        assert.equal(result.slices.length, 48);
        assert.ok(Math.log2(result.frequencies[1] / result.frequencies[0]) < 1 / 9);
        const slice = result.slices.find(value => value.depth >= 10);
        const peakIndex = slice.levels.indexOf(Math.max(...slice.levels.filter(Number.isFinite)));
        assert.ok(Math.abs(Math.log2(result.frequencies[peakIndex] / resonance)) < 1 / 6);
        for (const slice of result.slices) assert.ok(slice.levels.every(value => value === null || Number.isFinite(value)));
    }
});

test('Burst Decay module worker uses the same analysis and reports invalid requests', async t => {
    const moduleUrl = new URL('../../js/utils/measurement-dsp/analysis-worker.js', import.meta.url).href;
    const worker = new Worker(`const {parentPort}=require('node:worker_threads'); global.self={postMessage:value=>parentPort.postMessage(value)}; import(${JSON.stringify(moduleUrl)}).then(()=>parentPort.on('message',data=>self.onmessage({data})));`, { eval: true });
    t.after(() => worker.terminate());
    const record = impulse({ seconds: 0.1 });
    const settings = { minFrequency: 500, maxFrequency: 5000, maxSlices: 3, endCycles: 5 };
    const request = payload => new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Worker timed out')), 5000);
        worker.once('message', value => { clearTimeout(timer); resolve(value); });
        worker.postMessage(payload);
    });
    const response = await request({ id: 1, type: 'burst', record, settings });
    assert.deepEqual(response.result, analyzeBurstDecay(record, settings));
    assert.deepEqual(await request({ id: 2, type: 'burst', record, settings: { depthUnit: 'bad' } }),
        { id: 2, error: 'analysis-unavailable' });
});
