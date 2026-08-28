import assert from 'node:assert/strict';
import test from 'node:test';

import i18n from '../../features/measurement/i18n.js';
import dataStorage from '../../features/measurement/dataStorage.js';
import MeasurementDisplay, {
    hasDesignableChannelResponses
} from '../../features/measurement/ui/measurement-display.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';
import { UIManager } from '../../features/measurement/ui/ui-manager.js';

test('measurement output channels use output-specific display labels', () => {
    const display = new MeasurementDisplay({});

    assert.equal(display.formatOutputChannelInfo('all'), i18n.t('option:all') || 'All Channels');
    assert.equal(display.formatOutputChannelInfo('both'), i18n.t('option:all') || 'All Channels');
    for (let channel = 0; channel < 16; channel++) {
        assert.equal(display.formatOutputChannelInfo(String(channel)), `Ch ${channel + 1}`);
    }
    assert.equal(display.formatOutputChannelInfo('left'), 'Ch 1');
    assert.equal(display.formatOutputChannelInfo('right'), 'Ch 2');
    assert.equal(display.formatOutputChannelInfo('multi', ['left', '2', '3']), 'Ch 1, Ch 3, Ch 4');
    assert.equal(display.formatOutputChannelInfo('multi'), i18n.t('option:multiChannel') || 'Multiple Channels');
});

test('channel PEQ visibility requires a response for every measured channel', async () => {
    const complete = {
        outputChannel: 'multi',
        outputChannels: ['left', '2'],
        points: [{ pointId: 0 }],
        channelResponses: [
            { channel: 'left', averageFrequencyResponse: [[100, -1]] },
            { channel: '2', averageFrequencyResponse: [[100, -2]] }
        ]
    };
    const empty = {
        ...complete,
        channelResponses: [
            { channel: 'left', averageFrequencyResponse: [[100, -1]] },
            { channel: '2', averageFrequencyResponse: [] }
        ]
    };
    assert.equal(hasDesignableChannelResponses(complete), true);
    assert.equal(hasDesignableChannelResponses({ ...complete, points: [] }), false);
    assert.equal(hasDesignableChannelResponses(empty), false);
    assert.equal(hasDesignableChannelResponses({
        ...complete,
        channelResponses: complete.channelResponses.slice(0, 1)
    }), false);

    const filter = {
        hidden: true,
        replaceChildren() {},
        appendChild() {}
    };
    const copyButton = { hidden: false };
    const documentStub = {
        getElementById: id => id === 'resultsChannelFilter' ? filter
            : id === 'copyChannelPEQBtn' ? copyButton : null,
        createElement: () => ({
            className: '',
            dataset: {},
            classList: { toggle() {} },
            addEventListener() {}
        })
    };
    const display = new MeasurementDisplay({});
    await withGlobals({ document: documentStub }, async () => {
        display.updateChannelFilter(empty);
        assert.equal(copyButton.hidden, true);
        display.updateChannelFilter(complete);
        assert.equal(copyButton.hidden, false);
    });
});

test('measurement details show saved per-channel bands and legacy common or unlimited ranges', async t => {
    const measurement = {
        id: 'band-details', name: 'Band details', timestamp: '2026-08-27T00:00:00Z',
        outputChannel: 'multi', outputChannels: ['left', '2'], sampleRate: 32000,
        sweepLength: 1024, averaging: 1, points: [],
        sweepBand: { mode: 'perChannel', common: { minFreq: 20, maxFreq: 20000 }, perChannel: [
            { channel: 'left', minFreq: 40, maxFreq: 400 },
            { channel: '2', minFreq: 1500, maxFreq: 20000 }
        ] }
    };
    const originalGetMeasurement = dataStorage.getMeasurementById;
    const originalLoadSettings = dataStorage.loadPEQSettings;
    dataStorage.getMeasurementById = () => measurement;
    dataStorage.loadPEQSettings = () => null;
    t.after(() => {
        dataStorage.getMeasurementById = originalGetMeasurement;
        dataStorage.loadPEQSettings = originalLoadSettings;
    });
    const createElement = () => ({
        children: [], style: {},
        replaceChildren() { this.children = []; },
        append(...children) { this.children.push(...children); },
        appendChild(child) { this.children.push(child); }
    });
    const elements = new Map();
    const manager = new UIManager();
    const display = manager.measurementDisplay;
    display.displayMeasurementPoints = () => {};
    display.selectPoint = () => {};
    display.updateChannelFilter = () => {};
    manager.correctionHandler.updateFrequencyMarkers = () => {};
    await withGlobals({ document: {
        getElementById: id => {
            if (!elements.has(id)) elements.set(id, createElement());
            return elements.get(id);
        },
        createElement
    } }, async () => {
        const bandLabel = i18n.t('label:sweepBandMode') || 'Sweep Bandwidth:';
        const rows = () => elements.get('measurementDetails').children.map(row =>
            row.children.map(cell => cell.textContent)).filter(([label]) => label.startsWith(bandLabel));
        display.displayMeasurementDetails(measurement.id, true);
        assert.deepEqual(rows(), [
            [bandLabel, i18n.t('option:sweepBandPerChannel') || 'Per Channel'],
            [`${bandLabel} Ch 1`, '40–400 Hz'],
            [`${bandLabel} Ch 3`, `${(1500).toLocaleString()}–${(15999).toLocaleString()} Hz`]
        ]);
        delete measurement.sweepBand;
        measurement.sweepMinFreq = 80;
        measurement.sweepMaxFreq = 800;
        display.displayMeasurementDetails(measurement.id, true);
        assert.match(rows()[0][1], /80–800 Hz/);
        measurement.sweepBandLimited = false;
        display.displayMeasurementDetails(measurement.id, true);
        assert.match(rows()[0][1], /Off/);
        assert.ok(rows()[0][1].includes('31.25'));
    });
});

test('deleting a multichannel point queues every IR key and preserves the legacy missing-ID guard', async t => {
    const originalGetMeasurement = dataStorage.getMeasurementById;
    const multichannel = {
        id: 'multi',
        outputChannel: 'multi',
        outputChannels: ['left', '2'],
        points: [{
            pointId: 1,
            channels: [
                { channel: 'left', irId: 2, frequencyResponse: [[100, 0]] },
                { channel: '2', irId: 3, frequencyResponse: [[100, 1]] }
            ]
        }],
        channelResponses: []
    };
    const legacy = {
        id: 'legacy',
        points: [{ frequencyResponse: [[100, 0]] }]
    };
    dataStorage.getMeasurementById = id => id === 'multi' ? multichannel : legacy;
    t.after(() => { dataStorage.getMeasurementById = originalGetMeasurement; });
    const uiManager = {
        selectedMeasurementId: 'multi',
        hasUnsavedChanges: false,
        measurementStateGeneration: 0,
        correctionHandler: { requestCorrectionUpdate() {} }
    };
    const display = new MeasurementDisplay(uiManager);
    display.displayMeasurementDetails = () => {};

    await withGlobals({
        document: { getElementById: () => ({ style: {} }) }
    }, async () => {
        display.deletePoint(0);
        assert.deepEqual(multichannel._deletedPointIds, [2, 3]);

        uiManager.selectedMeasurementId = 'legacy';
        display.deletePoint(0);
        assert.deepEqual(legacy._deletedPointIds, []);
    });
});

test('failed IR JSON export shows a localized error and does not download', async t => {
    const originalExport = dataStorage.exportMeasurementToJSON;
    dataStorage.exportMeasurementToJSON = async () => {
        throw new Error('Simulated IR read failure');
    };
    t.after(() => { dataStorage.exportMeasurementToJSON = originalExport; });

    const notifications = [];
    const downloads = [];
    const display = new MeasurementDisplay({
        downloadFile: (...args) => downloads.push(args),
        showNotification: (...args) => notifications.push(args)
    });
    await withGlobals({
        document: {
            getElementById: id => id === 'includeImpulseResponses'
                ? { checked: true }
                : null
        }
    }, async () => {
        await display.exportMeasurement('measurement-1');
    });

    assert.deepEqual(downloads, []);
    assert.deepEqual(notifications, [[
        i18n.t('error:measurementExportFailed') ||
            'The measurement could not be exported. Please try again.',
        'error'
    ]]);
});
