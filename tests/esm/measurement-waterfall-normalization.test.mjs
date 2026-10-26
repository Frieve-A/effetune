import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeWaterfall, analyzeBurstDecay } from '../../js/utils/measurement-dsp/analysis.js';
import { buildWaterfallMesh } from '../../features/measurement/ui/waterfall-surface.js';

const cases = [
    ['Waterfall', analyzeWaterfall, { startSeconds: 0, endSeconds: 0.03, windowSeconds: 0.05, riseSeconds: 0.002 }],
    ['Burst cycles', analyzeBurstDecay, { depthUnit: 'cycles', endCycles: 20 }],
    ['Burst seconds', analyzeBurstDecay, { depthUnit: 'seconds', endSeconds: 0.2 }]
];

function measuredResponse() {
    const data = new Float32Array(2048);
    const onsetIndex = 80;
    data[onsetIndex] = 0.125;
    let noise = 42;
    for (let i = onsetIndex + 1; i < data.length; i++) {
        const n = i - onsetIndex;
        noise = (Math.imul(noise, 1664525) + 1013904223) >>> 0;
        data[i] = Math.exp(-n / 250) * (0.002 * Math.sin(2 * Math.PI * 500 * n / 8000) +
            0.0001 * (noise / 2 ** 32 - 0.5));
    }
    return { data, sampleRate: 8000, onsetIndex, refScale: 2,
        harmonicAnalysis: { quality: { valid: false, reasons: ['inconsistent-capture'] } } };
}

function mesh(result, normalization) {
    return buildWaterfallMesh({ waterfall: result, normalization, xMin: 100, xMax: 3000, yMin: -120, yMax: 10 });
}

for (const [name, analyze, settings] of cases) {
    test(`${name} keeps measured gain until view normalization and preserves the common amplitude reference`, () => {
        const record = measuredResponse();
        const saved = structuredClone(record);
        const options = { ...settings, minFrequency: 100, maxFrequency: 3000, maxSlices: 4 };
        const original = analyze(record, options);
        const originalResult = structuredClone(original);
        const amplified = analyze({ ...record, data: Float32Array.from(record.data, value => value * 2) }, options);
        const equivalent = analyze({ ...record, refScale: record.refScale / 2 }, options);
        const gainDb = 20 * Math.log10(2);
        const sourceLevels = original.slices.flatMap(slice => slice.levels).filter(Number.isFinite);
        const peak = Math.max(...sourceLevels);
        assert.ok(peak < -10, `Fixture must distinguish None from Global: ${peak}`);
        for (let row = 0; row < original.slices.length; row++) {
            for (let column = 0; column < original.frequencies.length; column++) {
                const level = original.slices[row].levels[column];
                if (level === null) {
                    assert.equal(amplified.slices[row].levels[column], null);
                    assert.equal(equivalent.slices[row].levels[column], null);
                    continue;
                }
                assert.ok(level > -250, 'Observed fixture values must stay above the numerical log floor');
                assert.ok(Math.abs(amplified.slices[row].levels[column] - level - gainDb) < 1e-8);
                assert.ok(Math.abs(equivalent.slices[row].levels[column] - amplified.slices[row].levels[column]) < 1e-8);
            }
        }
        if (name.startsWith('Burst')) {
            assert.ok(original.slices.some(slice => slice.levels.includes(null)), 'Fixture must exercise an unobserved late tail');
        }
        const raw = mesh(original, 'none');
        assert.ok(raw.triangles.length > 0);
        assert.equal(raw.levelOffset, 0);
        for (const normalization of ['none', 'global', 'frequency']) {
            const view = mesh(original, normalization);
            const louder = mesh(amplified, normalization);
            assert.equal(view.triangles.length, raw.triangles.length);
            assert.equal(louder.triangles.length, view.triangles.length);
            if (normalization === 'global') assert.equal(view.levelOffset, peak);
            const columnPeaks = new Map();
            for (let i = 0; i < view.triangles.length; i++) {
                for (let j = 0; j < 3; j++) {
                    const vertex = view.triangles[i][j];
                    const rawVertex = raw.triangles[i][j];
                    const expected = normalization === 'none' ? gainDb : 0;
                    assert.ok(Math.abs(louder.triangles[i][j].level - vertex.level - expected) < 1e-8);
                    if (normalization === 'global') assert.ok(Math.abs(vertex.level - rawVertex.level + peak) < 1e-8);
                    assert.equal(vertex.time, rawVertex.time);
                    assert.equal(vertex.frequency, rawVertex.frequency);
                    columnPeaks.set(vertex.frequency, Math.max(columnPeaks.get(vertex.frequency) ?? -Infinity, vertex.level));
                }
            }
            if (normalization === 'frequency') {
                assert.ok([...columnPeaks.values()].every(level => Math.abs(level) < 1e-8));
            }
        }
        assert.deepEqual(mesh(original, 'none'), raw);
        assert.deepEqual(original, originalResult);
        assert.deepEqual(record, saved);
    });
}
