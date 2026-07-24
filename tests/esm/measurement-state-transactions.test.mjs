import assert from 'node:assert/strict';
import test from 'node:test';

import dataStorage, { MeasurementImportError } from '../../features/measurement/dataStorage.js';
import audioUtils from '../../features/measurement/audio-utils/index.js';
import uiManager, { UIManager } from '../../features/measurement/ui/ui-manager.js';
import AudioProcessing from '../../features/measurement/measurement-controller/audio-processing.js';

const { default: SweepMeasurement } = await import(
    '../../features/measurement/measurement-controller/sweep-measurement.js'
);

function point(pointId, magnitude) {
    return {
        pointId,
        frequencyResponse: [[100, magnitude], [1000, magnitude + 1]],
        maxSignalLevel: -20 + pointId
    };
}

async function withPatchedSingletons(t, callback) {
    const originalAddMeasurement = dataStorage.addMeasurement;
    const originalDeleteMeasurement = dataStorage.deleteMeasurement;
    const originalShowNotification = uiManager.showNotification;
    const originalHighlight = uiManager.measurementDisplay.updateSelectedMeasurementHighlight;
    const originalMeasurements = dataStorage.measurements;
    const originalWindow = globalThis.window;
    const originalDocument = globalThis.document;
    const originalAlert = globalThis.alert;
    t.after(() => {
        dataStorage.addMeasurement = originalAddMeasurement;
        dataStorage.deleteMeasurement = originalDeleteMeasurement;
        uiManager.showNotification = originalShowNotification;
        uiManager.measurementDisplay.updateSelectedMeasurementHighlight = originalHighlight;
        dataStorage.measurements = originalMeasurements;
        globalThis.window = originalWindow;
        globalThis.document = originalDocument;
        globalThis.alert = originalAlert;
    });
    await callback();
}

test('failed deconvolution keeps FR fallback data but never exposes a persistable IR', async t => {
    const originalInverseFilter = audioUtils.lastInverseFilter;
    const originalRefScale = audioUtils.lastDeconvolutionRefScale;
    t.after(() => {
        audioUtils.lastInverseFilter = originalInverseFilter;
        audioUtils.lastDeconvolutionRefScale = originalRefScale;
    });
    audioUtils.lastDeconvolutionRefScale = 0.5;

    const fullRecording = new Float32Array(24);
    fullRecording[9] = 1;
    const cases = [
        {
            label: 'missing inverse',
            inverse: null,
            recording: fullRecording,
            sweepLength: 8,
            sampleRate: 16
        },
        {
            label: 'no complete segment',
            inverse: Float32Array.from([1]),
            recording: new Float32Array(4),
            sweepLength: 8,
            sampleRate: 16
        },
        {
            label: 'deconvolution exception',
            inverse: { length: Symbol('invalid') },
            recording: fullRecording,
            sweepLength: 8,
            sampleRate: 16
        }
    ];

    for (const scenario of cases) {
        audioUtils.lastInverseFilter = scenario.inverse;
        const result = AudioProcessing.processRecordedBuffer(
            scenario.recording,
            scenario.sweepLength,
            1,
            scenario.sampleRate
        );
        assert.strictEqual(result.analysisImpulseResponse, scenario.recording, scenario.label);
        assert.equal(result.irValid, false, scenario.label);
        assert.equal(result.impulseResponse, null, scenario.label);
    }
});

test('only valid deconvolution publishes IR metadata and binary for atomic saving', async t => {
    await withPatchedSingletons(t, async () => {
        const originalInverseFilter = audioUtils.lastInverseFilter;
        t.after(() => {
            audioUtils.lastInverseFilter = originalInverseFilter;
        });
        const sweepLength = 5000;
        const sampleRate = 100;
        const recording = new Float32Array(50 + sweepLength * 2);
        recording[50 + 4096] = 1;
        audioUtils.lastInverseFilter = Float32Array.from([1]);
        const valid = AudioProcessing.processRecordedBuffer(
            recording,
            sweepLength,
            1,
            sampleRate
        );
        assert.equal(valid.irValid, true);
        assert.ok(valid.impulseResponse instanceof Float32Array);
        const sweepResult = AudioProcessing.createSweepMeasurementResult(valid, {
            frequencyResponse: [[100, 0]],
            maxSignalLevel: -20,
            sampleRate
        });
        assert.equal(sweepResult.irValid, true);

        const savedImpulseResponses = [];
        dataStorage.addMeasurement = async (measurement, impulseResponse) => {
            savedImpulseResponses.push(impulseResponse);
            return measurement.id;
        };
        const controller = {
            ...SweepMeasurement,
            currentMeasurement: { id: 'measurement-ir-validity', points: [], nextPointId: 0 }
        };
        controller.acceptMeasurementResult({
            frequencyResponse: [[100, 0]],
            maxSignalLevel: -20,
            sampleRate,
            irValid: false,
            impulseResponse: null
        });
        assert.equal(controller.currentPoint.ir, undefined);
        assert.equal(controller.currentImpulseResponse, null);
        await controller.saveCurrentPoint();
        assert.equal(savedImpulseResponses[0], null);

        controller.currentMeasurement = { id: 'measurement-ir-validity', points: [], nextPointId: 0 };
        controller.acceptMeasurementResult(sweepResult);
        assert.equal(controller.currentPoint.ir.stored, true);
        assert.strictEqual(controller.currentImpulseResponse.data, valid.impulseResponse);
        await controller.saveCurrentPoint();
        assert.strictEqual(savedImpulseResponses[1].data, valid.impulseResponse);
    });
});

for (const [label, committedPoints] of [
    ['first point', []],
    ['additional point', [point(0, 1)]]
]) {
    test(`${label} save failure preserves the retryable current measurement`, async t => {
        await withPatchedSingletons(t, async () => {
            const notices = [];
            dataStorage.addMeasurement = async () => {
                throw new Error('Simulated storage failure');
            };
            uiManager.showNotification = message => notices.push(message);
            uiManager.measurementDisplay.updateSelectedMeasurementHighlight = () => {};

            const currentPoint = point(committedPoints.length, 5);
            const currentMeasurement = {
                id: `measurement-${label}`,
                points: structuredClone(committedPoints),
                ...(committedPoints.length ? {
                    averageFrequencyResponse: [[100, 1], [1000, 2]],
                    maxSignalLevel: -20
                } : {})
            };
            const controller = {
                ...SweepMeasurement,
                currentMeasurement,
                currentPoint,
                currentImpulseResponse: { pointId: currentPoint.pointId },
                resetForNextSweepMeasurement() {
                    assert.fail('failed saves must not advance to another sweep');
                }
            };

            await assert.rejects(controller.saveAndContinueMeasurement(), /storage failure/);
            assert.strictEqual(controller.currentMeasurement, currentMeasurement);
            assert.deepEqual(controller.currentMeasurement.points, committedPoints);
            assert.strictEqual(controller.currentPoint, currentPoint);
            assert.equal(notices.length, 1);
            assert.match(notices[0], /could not be saved/i);
        });
    });
}

test('corrected point deletion followed by Discard restores the complete snapshot and rejects stale correction', async t => {
    await withPatchedSingletons(t, async () => {
        let resolveCalculation;
        let calculationStarted = false;
        const pendingCalculation = new Promise(resolve => {
            resolveCalculation = resolve;
        });
        const measurement = {
            id: 'measurement-edit',
            name: 'Corrected',
            timestamp: '2026-07-21T00:00:00.000Z',
            points: [point(0, 1), point(1, 3)],
            averageFrequencyResponse: [[100, 2], [1000, 3]],
            maxSignalLevel: -19.5,
            correctionLowFreq: 30,
            correctionHighFreq: 18000,
            smoothing: 0.25,
            eqBandCount: 3,
            peqParameters: [{ frequency: 100, gain: -2, Q: 1 }],
            correctedResponse: [[100, 0], [1000, 0.5]]
        };
        const original = structuredClone(measurement);
        dataStorage.measurements = [measurement];

        const elements = new Map([
            ['loading-spinner-results', { style: { display: 'none' } }],
            ['editActions', { style: { display: 'none' } }],
            ['targetLowFreqSlider', { value: '0' }],
            ['targetHighFreqSlider', { value: '1' }],
            ['smoothing', { value: '0.5' }],
            ['eqBandCount', { value: '5' }],
            ['targetLowFreqValue', { textContent: '' }],
            ['targetHighFreqValue', { textContent: '' }],
            ['smoothingValue', { textContent: '' }]
        ]);
        globalThis.document = { getElementById: id => elements.get(id) };
        globalThis.window = { app: { audioUtils: {
            smoothFrequencyResponse: response => response,
            calculatePEQParameters: () => {
                calculationStarted = true;
                return pendingCalculation;
            },
            applyCorrectionToResponse: () => [[100, 99]]
        } } };

        const manager = new UIManager();
        manager.selectedMeasurementId = measurement.id;
        manager.updateResultsGraph = () => {};
        manager.graphRenderer.normalizeResponseToZeroDb = response => response;
        manager.measurementDisplay.displayMeasurementDetails = () => {};
        manager.correctionHandler.updateFrequencyMarkers = () => {};

        manager.measurementDisplay.deletePoint(0);
        assert.equal(manager.hasUnsavedChanges, true);
        assert.equal(measurement.points.length, 1);
        assert.equal(calculationStarted, true);
        manager.discardChanges();
        resolveCalculation([{ frequency: 1000, gain: 12, Q: 10 }]);
        await pendingCalculation;
        await new Promise(resolve => setImmediate(resolve));

        assert.deepEqual(measurement, original);
        assert.equal(manager.hasUnsavedChanges, false);
        assert.equal(elements.get('loading-spinner-results').style.display, 'none');
    });
});

test('typed import persistence failure shows localized storage guidance instead of invalid format', async t => {
    await withPatchedSingletons(t, async () => {
        const originalImport = dataStorage.importMeasurementFromJSON;
        t.after(() => {
            dataStorage.importMeasurementFromJSON = originalImport;
        });
        dataStorage.importMeasurementFromJSON = async () => {
            throw new MeasurementImportError('storage', new Error('quota'));
        };
        let notice = null;
        let alerts = 0;
        globalThis.alert = () => { alerts += 1; };
        const manager = new UIManager();
        manager.showNotification = message => { notice = message; };

        assert.equal(await manager.importMeasurementText('{}'), null);
        assert.match(notice, /could not be saved/i);
        assert.equal(alerts, 0);
    });
});

test('imported device names render as literal text without HTML injection', async t => {
    await withPatchedSingletons(t, async () => {
        const originalLoadPEQSettings = dataStorage.loadPEQSettings;
        t.after(() => {
            dataStorage.loadPEQSettings = originalLoadPEQSettings;
        });
        dataStorage.measurements = [];
        dataStorage.addMeasurement = async measurement => {
            dataStorage.measurements = [measurement];
            return measurement.id;
        };
        dataStorage.loadPEQSettings = () => null;

        const malicious = '<img src=x onerror="globalThis.injected=true">';
        const measurementId = await dataStorage.importMeasurementFromJSON(JSON.stringify({
            name: 'Imported',
            timestamp: '2026-07-21T00:00:00.000Z',
            audioInput: malicious,
            audioOutput: '<script>globalThis.injected=true</script>',
            inputChannel: 'left',
            outputChannel: 'right',
            sampleRate: 48000,
            sweepLength: '65536',
            averaging: 1,
            points: [{ pointId: 0, frequencyResponse: [[100, 0]] }]
        }));

        class FakeElement {
            constructor() {
                this.children = [];
                this.style = {};
                this.textContent = '';
                this.value = '';
            }
            replaceChildren() { this.children = []; }
            append(...children) { this.children.push(...children); }
            appendChild(child) { this.children.push(child); }
        }
        const elements = new Map();
        const details = new FakeElement();
        Object.defineProperty(details, 'innerHTML', {
            set() { assert.fail('measurement details must not use innerHTML'); }
        });
        elements.set('measurementDetails', details);
        globalThis.document = {
            getElementById: id => {
                if (!elements.has(id)) elements.set(id, new FakeElement());
                return elements.get(id);
            },
            createElement: () => new FakeElement()
        };
        globalThis.injected = false;
        t.after(() => { delete globalThis.injected; });

        const manager = new UIManager();
        manager.measurementDisplay.displayMeasurementPoints = () => {};
        manager.measurementDisplay.selectPoint = () => {};
        manager.correctionHandler.updateFrequencyMarkers = () => {};
        manager.correctionHandler.updateCorrection = () => {};
        manager.measurementDisplay.displayMeasurementDetails(measurementId, true);

        assert.equal(details.children[1].children[1].textContent, malicious);
        assert.equal(details.children[3].children[1].textContent,
            '<script>globalThis.injected=true</script>');
        assert.equal(globalThis.injected, false);
    });
});

test('double Save and Continue shares one persistence and one next-sweep transition', async t => {
    await withPatchedSingletons(t, async () => {
        let resolveSave;
        const pendingSave = new Promise(resolve => { resolveSave = resolve; });
        let saveCalls = 0;
        let highlightCalls = 0;
        let resetCalls = 0;
        dataStorage.addMeasurement = async () => {
            saveCalls += 1;
            await pendingSave;
            return 'measurement-single-flight';
        };
        uiManager.measurementDisplay.updateSelectedMeasurementHighlight = () => {
            highlightCalls += 1;
        };
        const buttons = new Map([
            ['saveAndContinueBtn', { disabled: false }],
            ['saveAndFinishBtn', { disabled: false }]
        ]);
        globalThis.document = { getElementById: id => buttons.get(id) };
        const controller = {
            ...SweepMeasurement,
            currentMeasurement: { id: 'measurement-single-flight', points: [] },
            currentPoint: point(0, 2),
            currentImpulseResponse: impulseRecordForController(0),
            resetForNextSweepMeasurement() { resetCalls += 1; }
        };

        const first = controller.saveAndContinueMeasurement();
        const second = controller.saveAndContinueMeasurement();
        assert.equal(saveCalls, 1);
        assert.equal(buttons.get('saveAndContinueBtn').disabled, true);
        assert.equal(buttons.get('saveAndFinishBtn').disabled, true);
        resolveSave();

        assert.deepEqual(await Promise.all([first, second]), [
            'measurement-single-flight',
            'measurement-single-flight'
        ]);
        assert.equal(saveCalls, 1);
        assert.equal(highlightCalls, 1);
        assert.equal(resetCalls, 1);
        assert.equal(buttons.get('saveAndContinueBtn').disabled, false);
        assert.equal(buttons.get('saveAndFinishBtn').disabled, false);
    });
});

test('double Save and Finish shares one persistence and one published point', async t => {
    await withPatchedSingletons(t, async () => {
        let resolveSave;
        const pendingSave = new Promise(resolve => { resolveSave = resolve; });
        let saveCalls = 0;
        dataStorage.addMeasurement = async () => {
            saveCalls += 1;
            await pendingSave;
            return 'measurement-finish-single-flight';
        };
        const buttons = new Map([
            ['saveAndContinueBtn', { disabled: false }],
            ['saveAndFinishBtn', { disabled: false }]
        ]);
        globalThis.document = { getElementById: id => buttons.get(id) };
        const controller = {
            ...SweepMeasurement,
            currentMeasurement: { id: 'measurement-finish-single-flight', points: [] },
            currentPoint: point(0, 2),
            currentImpulseResponse: impulseRecordForController(0)
        };

        const first = controller.saveAndFinishMeasurement();
        const second = controller.saveAndFinishMeasurement();
        assert.equal(saveCalls, 1);
        assert.equal(buttons.get('saveAndContinueBtn').disabled, true);
        assert.equal(buttons.get('saveAndFinishBtn').disabled, true);
        resolveSave();

        assert.deepEqual(await Promise.all([first, second]), [
            'measurement-finish-single-flight',
            'measurement-finish-single-flight'
        ]);
        assert.equal(saveCalls, 1);
        assert.equal(controller.currentMeasurement.points.length, 1);
        assert.equal(buttons.get('saveAndContinueBtn').disabled, false);
        assert.equal(buttons.get('saveAndFinishBtn').disabled, false);
    });
});

test('failed Save releases the guard and remains retryable', async t => {
    await withPatchedSingletons(t, async () => {
        let saveCalls = 0;
        let resetCalls = 0;
        dataStorage.addMeasurement = async () => {
            saveCalls += 1;
            if (saveCalls === 1) throw new Error('temporary write failure');
            return 'measurement-retried';
        };
        uiManager.showNotification = () => {};
        uiManager.measurementDisplay.updateSelectedMeasurementHighlight = () => {};
        const buttons = new Map([
            ['saveAndContinueBtn', { disabled: false }],
            ['saveAndFinishBtn', { disabled: false }]
        ]);
        globalThis.document = { getElementById: id => buttons.get(id) };
        const currentPoint = point(0, 2);
        const controller = {
            ...SweepMeasurement,
            currentMeasurement: { id: 'measurement-retried', points: [] },
            currentPoint,
            currentImpulseResponse: impulseRecordForController(0),
            resetForNextSweepMeasurement() { resetCalls += 1; }
        };

        await assert.rejects(controller.saveAndContinueMeasurement(), /temporary write failure/);
        assert.strictEqual(controller.currentPoint, currentPoint);
        assert.equal(controller.currentMeasurement.points.length, 0);
        assert.equal(controller.saveActionPromise, null);
        assert.equal(buttons.get('saveAndContinueBtn').disabled, false);

        assert.equal(await controller.saveAndContinueMeasurement(), 'measurement-retried');
        assert.equal(saveCalls, 2);
        assert.equal(resetCalls, 1);
        assert.equal(buttons.get('saveAndFinishBtn').disabled, false);
    });
});

test('discard-and-continue navigation restores the full snapshot before continuing', async t => {
    await withPatchedSingletons(t, async () => {
        for (const workflow of ['select', 'start']) {
            const original = {
                id: `measurement-navigation-${workflow}`,
                name: 'Original',
                points: [point(0, 1), point(1, 3)],
                averageFrequencyResponse: [[100, 2]],
                peqParameters: [{ frequency: 100, gain: -2, Q: 1 }],
                correctedResponse: [[100, 0]]
            };
            const measurement = {
                ...structuredClone(original),
                _editSnapshot: structuredClone(original),
                _deletedPointIds: [1]
            };
            measurement.name = 'Edited';
            measurement.points.pop();
            measurement.averageFrequencyResponse = [[100, 99]];
            measurement.peqParameters = [{ frequency: 1000, gain: 12, Q: 10 }];
            dataStorage.measurements = [measurement];

            const manager = new UIManager();
            manager.selectedMeasurementId = measurement.id;
            manager.hasUnsavedChanges = true;
            manager.cleanupAudioBeforeNavigation = () => {};
            manager.dialogController.showConfirmation = () => {};
            const generation = manager.measurementStateGeneration;
            let continuedWith = null;

            if (workflow === 'select') {
                assert.equal(await manager.measurementDisplay.selectMeasurement('measurement-other'), false);
                const pending = manager.pendingAction;
                manager.measurementDisplay.selectMeasurement = id => { continuedWith = id; };
                pending();
                assert.equal(continuedWith, 'measurement-other');
            } else {
                await manager.startNewMeasurement();
                const pending = manager.pendingAction;
                manager.startNewMeasurement = () => { continuedWith = 'start'; };
                pending();
                assert.equal(continuedWith, 'start');
            }

            assert.deepEqual(measurement, original);
            assert.equal(manager.hasUnsavedChanges, false);
            assert.equal(manager.measurementStateGeneration, generation + 1);
        }
    });
});

test('measurement deletion updates the UI only after persistence succeeds and notifies on failure', async t => {
    await withPatchedSingletons(t, async () => {
        let resolveDelete;
        dataStorage.deleteMeasurement = () => new Promise(resolve => { resolveDelete = resolve; });
        const manager = new UIManager();
        manager.selectedMeasurementId = 'measurement-other';
        let listUpdates = 0;
        let notice = null;
        manager.measurementDisplay.updateMeasurementList = () => { listUpdates += 1; };
        manager.showNotification = message => { notice = message; };

        const deletion = manager.measurementDisplay.deleteMeasurement('measurement-delete');
        assert.equal(listUpdates, 0);
        resolveDelete(true);
        assert.equal(await deletion, true);
        assert.equal(listUpdates, 1);
        assert.equal(notice, null);

        dataStorage.deleteMeasurement = async () => false;
        assert.equal(await manager.measurementDisplay.deleteMeasurement('measurement-delete'), false);
        assert.equal(listUpdates, 1);
        assert.match(notice, /could not be deleted/i);
    });
});

function impulseRecordForController(pointId) {
    return {
        measurementId: 'measurement-controller',
        pointId,
        sampleRate: 48000,
        onsetIndex: 0,
        data: Float32Array.from([1])
    };
}
