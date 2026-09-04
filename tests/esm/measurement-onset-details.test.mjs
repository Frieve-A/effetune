import assert from 'node:assert/strict';
import test from 'node:test';

import i18n from '../../features/measurement/i18n.js';
import dataStorage from '../../features/measurement/dataStorage.js';
import { UIManager } from '../../features/measurement/ui/ui-manager.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';

const ONSET_LABEL = i18n.t('label:onset') || 'Onset';
const EARLIEST = i18n.t('label:onsetEarliest') || 'earliest';

function createElement() {
    return {
        children: [], style: {},
        replaceChildren() { this.children = []; },
        append(...children) { this.children.push(...children); },
        appendChild(child) { this.children.push(child); }
    };
}

function harness(t, measurement) {
    const originalGetMeasurement = dataStorage.getMeasurementById;
    const originalLoadSettings = dataStorage.loadPEQSettings;
    dataStorage.getMeasurementById = id => id === measurement.id ? measurement : null;
    dataStorage.loadPEQSettings = () => null;
    t.after(() => {
        dataStorage.getMeasurementById = originalGetMeasurement;
        dataStorage.loadPEQSettings = originalLoadSettings;
    });

    const elements = new Map();
    const manager = new UIManager();
    const display = manager.measurementDisplay;
    manager.selectedMeasurementId = measurement.id;
    display.displayMeasurementPoints = () => {};
    display.selectPoint = () => {};
    display.updateChannelFilter = () => {};
    manager.correctionHandler.updateFrequencyMarkers = () => {};
    const documentStub = {
        getElementById: id => {
            if (!elements.has(id)) elements.set(id, createElement());
            return elements.get(id);
        },
        createElement
    };
    const onsetRows = () => elements.get('measurementDetails').children
        .map(row => row.children.map(cell => cell.textContent))
        .filter(([label]) => label.startsWith(ONSET_LABEL));
    return { display, documentStub, onsetRows };
}

test('measurement details report the absolute onset of every stored channel', async t => {
    const measurement = {
        id: 'onset-multi', name: 'Onset multi', timestamp: '2026-09-04T00:00:00Z',
        outputChannel: 'multi', outputChannels: ['left', 'right'], sampleRate: 48000,
        sweepLength: 65536, averaging: 1,
        points: [{
            pointId: 0,
            name: 'Point 1',
            channels: [
                {
                    channel: 'left', irId: 1,
                    ir: { stored: true, length: 72000, sampleRate: 48000, onsetIndex: 4096,
                        trimStartSamples: 24000 }
                },
                {
                    channel: 'right', irId: 2,
                    ir: { stored: true, length: 72000, sampleRate: 48000, onsetIndex: 4096,
                        trimStartSamples: 24014 }
                }
            ]
        }]
    };
    const { display, documentStub, onsetRows } = harness(t, measurement);
    await withGlobals({ document: documentStub }, async () => {
        display.displayMeasurementDetails(measurement.id, true);
        assert.deepEqual(onsetRows(), [[
            `${ONSET_LABEL} (Point 1)`,
            `Ch 1: 585.333 ms (${EARLIEST}) / Ch 2: 585.625 ms (+0.292 ms)`
        ]]);
    });
});

test('single-channel measurement details show one onset without a channel spread', async t => {
    const measurement = {
        id: 'onset-single', name: 'Onset single', timestamp: '2026-09-04T00:00:00Z',
        outputChannel: 'left', sampleRate: 48000, sweepLength: 65536, averaging: 1,
        points: [{
            pointId: 7,
            name: 'Point 1',
            ir: { stored: true, length: 72000, sampleRate: 48000, onsetIndex: 4096,
                trimStartSamples: 24000 }
        }]
    };
    const { display, documentStub, onsetRows } = harness(t, measurement);
    await withGlobals({ document: documentStub }, async () => {
        display.displayMeasurementDetails(measurement.id, true);
        assert.deepEqual(onsetRows(), [[`${ONSET_LABEL} (Point 1)`, '585.333 ms']]);
    });
});

test('an anchor that precedes the scheduled playback frame reports the path latency', async t => {
    const measurement = {
        id: 'onset-negative', name: 'Onset negative', timestamp: '2026-09-04T00:00:00Z',
        outputChannel: 'left', sampleRate: 48000, sweepLength: 65536, averaging: 1,
        points: [{
            pointId: 3,
            name: 'Point 1',
            ir: { stored: true, length: 72000, sampleRate: 48000, onsetIndex: 576,
                trimStartSamples: -320 }
        }]
    };
    const { display, documentStub, onsetRows } = harness(t, measurement);
    await withGlobals({ document: documentStub }, async () => {
        display.displayMeasurementDetails(measurement.id, true);
        assert.deepEqual(onsetRows(), [[`${ONSET_LABEL} (Point 1)`, '5.333 ms']]);
    });
});

test('impulse responses without an anchor contribute no onset row', async t => {
    const measurement = {
        id: 'onset-unanchored', name: 'Onset unanchored', timestamp: '2026-09-04T00:00:00Z',
        outputChannel: 'multi', outputChannels: ['left', 'right'], sampleRate: 48000,
        sweepLength: 65536, averaging: 1,
        points: [{
            pointId: 0,
            name: 'Point 1',
            channels: [
                { channel: 'left', irId: 1,
                    ir: { stored: true, length: 72000, sampleRate: 48000, onsetIndex: 4096 } },
                { channel: 'right', irId: 2,
                    ir: { stored: true, length: 72000, sampleRate: 48000, onsetIndex: 4096 } }
            ]
        }]
    };
    const { display, documentStub, onsetRows } = harness(t, measurement);
    await withGlobals({ document: documentStub }, async () => {
        display.displayMeasurementDetails(measurement.id, true);
        assert.deepEqual(onsetRows(), []);
    });
});

test('points without a stored impulse response contribute no onset row', async t => {
    const measurement = {
        id: 'onset-none', name: 'Onset none', timestamp: '2026-09-04T00:00:00Z',
        outputChannel: 'left', sampleRate: 48000, sweepLength: 65536, averaging: 1,
        points: [{ pointId: 0, name: 'Point 1' }]
    };
    const { display, documentStub, onsetRows } = harness(t, measurement);
    await withGlobals({ document: documentStub }, async () => {
        display.displayMeasurementDetails(measurement.id, true);
        assert.deepEqual(onsetRows(), []);
    });
});
