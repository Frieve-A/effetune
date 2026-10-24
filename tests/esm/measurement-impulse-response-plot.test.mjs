import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
    clampImpulseView,
    createDefaultImpulseView,
    findImpulsePeak,
    getImpulseTimeBounds,
    getNiceTimeTickInterval,
    sampleImpulseEnvelope
} from '../../features/measurement/ui/impulse-response-plot.js';
import audioUtils from '../../features/measurement/audio-utils/index.js';
import dataStorage from '../../features/measurement/dataStorage.js';
import GraphRenderer from '../../features/measurement/ui/graph-renderer.js';

function impulseRecord({
    sampleRate = 48000,
    onsetIndex = 480,
    length = 48000,
    data
} = {}) {
    return {
        sampleRate,
        onsetIndex,
        data: data || new Float32Array(length)
    };
}

test('impulse response plot opens on the normalized first 10 ms after onset', () => {
    const record = impulseRecord();
    record.data[record.onsetIndex] = -0.25;
    record.data[record.onsetIndex + 10] = 0.75;

    assert.deepEqual(createDefaultImpulseView(record), {
        startMs: 0,
        durationMs: 10
    });
    assert.equal(findImpulsePeak(record.data), 0.75);
});

test('impulse response view clamps zooming and scrolling to the stored response', () => {
    const bounds = getImpulseTimeBounds(impulseRecord());
    assert.equal(bounds.minMs, -10);
    assert.equal(bounds.maxMs, 990);

    assert.deepEqual(clampImpulseView(-200, 100, bounds), {
        startMs: -10,
        durationMs: 100
    });
    assert.deepEqual(clampImpulseView(950, 100, bounds), {
        startMs: 890,
        durationMs: 100
    });
    assert.deepEqual(clampImpulseView(0, 5000, bounds), {
        startMs: -10,
        durationMs: 1000
    });
});

test('impulse response envelope preserves narrow extrema when zoomed out', () => {
    const data = new Float32Array(10000);
    data[4321] = 0.9;
    data[4322] = -0.8;
    const record = impulseRecord({
        sampleRate: 1000,
        onsetIndex: 0,
        length: data.length,
        data
    });
    const envelope = sampleImpulseEnvelope(
        record,
        { startMs: 0, durationMs: 10000 },
        100
    );

    assert.equal(envelope.length, 100);
    assert.ok(envelope.some(bucket => bucket.maximum === data[4321]));
    assert.ok(envelope.some(bucket => bucket.minimum === data[4322]));
    assert.equal(getNiceTimeTickInterval(10), 2);
});

test('measurement results place the interactive impulse graph before IR export options', () => {
    const html = readFileSync(
        new URL('../../features/measurement/measurement.html', import.meta.url),
        'utf8'
    );
    const graphIndex = html.indexOf('id="impulseResponseSection"');
    const wavExportIndex = html.indexOf('id="exportImpulseResponseWav"');
    const exportOptionIndex = html.indexOf('id="includeImpulseResponses"');

    assert.ok(graphIndex >= 0 && graphIndex < exportOptionIndex);
    assert.ok(graphIndex < wavExportIndex && wavExportIndex < exportOptionIndex);
    assert.match(html, /id="impulseResponseGraph"[^>]+tabindex="0"/);
    assert.match(html, /id="impulseResponseScroll"[^>]+type="range"/);
    assert.match(html, /id="impulseResponseZoomIn"/);
    assert.match(html, /id="impulseResponseZoomOut"/);
});

test('impulse response WAV export uses the selected point data and sample rate', t => {
    const originalGetMeasurementById = dataStorage.getMeasurementById;
    const originalExportWAV = audioUtils.exportWAV;
    const measurement = {
        id: 'measurement-1',
        name: 'Living Room',
        points: [
            { pointId: 7, name: 'Main Seat', ir: { stored: true } }
        ]
    };
    const record = {
        measurementId: measurement.id,
        pointId: 7,
        sampleRate: 96000,
        onsetIndex: 1,
        data: Float32Array.from([0.1, 0.5, -0.25])
    };
    dataStorage.getMeasurementById = id => id === measurement.id ? measurement : null;
    const exports = [];
    audioUtils.exportWAV = (...args) => exports.push(args);
    t.after(() => {
        dataStorage.getMeasurementById = originalGetMeasurementById;
        audioUtils.exportWAV = originalExportWAV;
    });

    const renderer = new GraphRenderer({
        selectedMeasurementId: measurement.id,
        graphColors: { original: '#fff' }
    });
    renderer.impulseResponse = record;
    renderer.exportImpulseResponseWav();

    assert.equal(exports.length, 1);
    assert.strictEqual(exports[0][0], record.data);
    assert.equal(exports[0][1], 96000);
    assert.match(
        exports[0][2],
        /^living_room_main_seat_impulse_response_\d{4}-\d{2}-\d{2}\.wav$/
    );
});
