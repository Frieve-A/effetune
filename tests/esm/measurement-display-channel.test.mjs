import assert from 'node:assert/strict';
import test from 'node:test';

import i18n from '../../features/measurement/i18n.js';
import dataStorage from '../../features/measurement/dataStorage.js';
import MeasurementDisplay from '../../features/measurement/ui/measurement-display.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';

test('measurement output channels use output-specific display labels', () => {
    const display = new MeasurementDisplay({});

    assert.equal(display.formatOutputChannelInfo('all'), i18n.t('option:all') || 'All Channels');
    assert.equal(display.formatOutputChannelInfo('both'), i18n.t('option:all') || 'All Channels');
    for (let channel = 0; channel < 8; channel++) {
        assert.equal(display.formatOutputChannelInfo(String(channel)), `Ch ${channel + 1}`);
    }
    assert.equal(display.formatOutputChannelInfo('left'), 'Ch 1');
    assert.equal(display.formatOutputChannelInfo('right'), 'Ch 2');
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
