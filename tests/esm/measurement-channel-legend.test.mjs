import assert from 'node:assert/strict';
import test from 'node:test';
import AnalysisController from '../../features/measurement/ui/analysis-controller.js';
import { resolveDisplayedResponse } from '../../features/measurement/measurement-model.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';

function controllerFor(measurement, channel, point = 'all') {
    const controller = new AnalysisController({
        measurementDisplay: { selectedChannel: channel, selectedPointIndex: point },
        graphColors: { original: 'blue', correction: 'orange', corrected: 'green' },
        correctionHandler: { generateCorrectionCurve: (_parameters, response) => response.map(([frequency]) => [frequency, -1]) }
    });
    controller.measurement = measurement;
    controller.displayed = resolveDisplayedResponse(measurement, point, channel);
    controller.settings.frequency.smoothing = 0;
    return controller;
}

test('selected channel correction and corrected response use the displayed channel frequency grid', async () => {
    const measurement = {
        outputChannels: ['left', '2'], points: [{}],
        averageFrequencyResponse: [[100, 0], [1600, 0]],
        channelResponses: [{ channel: '2', averageFrequencyResponse: [[1500, 1], [1800, 3]] }],
        sweepBand: { mode: 'perChannel', common: { minFreq: 20, maxFreq: 20000 },
            perChannel: [{ channel: '2', minFreq: 1500, maxFreq: 1800 }] },
        peqParameters: [{ frequency: 1650, gain: -1, Q: 2 }]
    };
    const controller = controllerFor(measurement, '2');
    await withGlobals({ document: { getElementById: id => ({ checked: id !== 'showOriginal' }) } }, () => {
        const series = controller.frequencySeries();
        assert.deepEqual(series.map(({ color, points }) => ({ color, points })), [
            { color: 'orange', points: [[1500, -1], [1800, -1]] },
            { color: 'green', points: [[1500, -2], [1800, 0]] }
        ]);
    });
});

test('all output curves retain their channel labels and a shared normalization reference', async () => {
    const measurement = {
        outputChannels: ['left', '2'], sweepMinFreq: 20, sweepMaxFreq: 20000,
        averageFrequencyResponse: [[100, 0], [1000, 0]],
        channelResponses: [
            { channel: 'left', averageFrequencyResponse: [[100, -1], [1000, 1]] },
            { channel: '2', averageFrequencyResponse: [[100, 1], [1000, -1]] }
        ],
        points: [{ pointId: 1, channels: [
            { channel: 'left', frequencyResponse: [[100, -1], [1000, 1]] },
            { channel: '2', frequencyResponse: [[100, 1], [1000, -1]] }
        ] }]
    };
    const controller = controllerFor(measurement, 'all', 0);
    await withGlobals({ document: { getElementById: id => ({ checked: id === 'showOriginal' }) } }, () => {
        const series = controller.frequencySeries();
        assert.equal(series.length, 2);
        assert.notEqual(series[0].label, series[1].label);
        assert.deepEqual(series[0].points, [[100, -1], [1000, 1]]);
        assert.deepEqual(series[1].points, [[100, 1], [1000, -1]]);
        assert.notEqual(series[0].color, series[1].color);
    });
});
