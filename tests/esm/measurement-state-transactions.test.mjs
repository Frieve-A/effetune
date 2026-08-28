import assert from 'node:assert/strict';
import test from 'node:test';

import dataStorage, { MeasurementImportError } from '../../features/measurement/dataStorage.js';
import audioUtils from '../../features/measurement/audio-utils/index.js';
import uiManager, { UIManager } from '../../features/measurement/ui/ui-manager.js';
import AudioProcessing, {
    createSweepCapturePlan,
    SweepCancelledError
} from '../../features/measurement/measurement-controller/audio-processing.js';
import {
    default as measurementController,
    MeasurementController,
    MeasurementSetupError
} from '../../features/measurement/measurement-controller/index.js';
import LevelAdjustment from '../../features/measurement/measurement-controller/level-adjustment.js';
import { createImpulseResponseMeasurement } from '../../features/measurement/impulse-response-import.js';

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

function radioGroup(value, values = ['left', '2', 'auto', 'manual']) {
    let selected = value;
    const radios = values.map(option => ({
        value: option,
        get checked() { return selected === option; },
        set checked(checked) { if (checked) selected = option; else if (selected === option) selected = null; }
    }));
    return {
        querySelector: selector => selector?.includes('value=')
            ? radios.find(radio => selector.includes(`"${radio.value}"`))
            : radios.find(radio => radio.checked),
        querySelectorAll: () => radios
    };
}

function measurementConfig(interfaceCalibration = null) {
    return {
        name: 'New measurement',
        audioInput: 'Input',
        audioInputId: 'input-id',
        inputChannel: 'left',
        audioOutput: 'Output',
        audioOutputId: 'output-id',
        outputChannel: 'right',
        sampleRate: 48000,
        sweepLength: '65536',
        sweepMinFreq: 20,
        sweepMaxFreq: 20000,
        averaging: 4,
        ...(interfaceCalibration ? { interfaceCalibration } : {})
    };
}

function createSweepTestElements() {
    const context = {
        clearRect() {},
        fillRect() {},
        beginPath() {},
        moveTo() {},
        lineTo() {},
        stroke() {},
        fillText() {}
    };
    const canvas = { width: 640, height: 320, getContext: () => context };
    return new Map([
        ['levelGraph', canvas],
        ['frequencyResponseGraph', canvas],
        ['measurementActionsExplanation', { style: {} }],
        ['redoBtn', { style: {} }],
        ['saveAndContinueBtn', { style: {} }],
        ['saveAndFinishBtn', { style: {} }],
        ['redoChannelLabel', { hidden: true }],
        ['redoChannelSelect', { hidden: true }],
        ['redoChannelBtn', { hidden: true }],
        ['sweepChannelProgress', { hidden: true, textContent: '' }]
    ]);
}

test('automatic test-signal rotation is single-flight and removes stale async output', async t => {
    const originals = {
        document: globalThis.document,
        setInterval: globalThis.setInterval,
        clearInterval: globalThis.clearInterval,
        isWhiteNoiseActive: audioUtils.isWhiteNoiseActive,
        isWhiteNoisePending: audioUtils.isWhiteNoisePending,
        whiteNoiseDesiredActive: audioUtils.whiteNoiseDesiredActive,
        whiteNoiseOperationToken: audioUtils.whiteNoiseOperationToken,
        whiteNoiseChannel: audioUtils.whiteNoiseChannel,
        startWhiteNoise: audioUtils.startWhiteNoise,
        stopWhiteNoise: audioUtils.stopWhiteNoise,
        showNotification: uiManager.showNotification
    };
    t.after(() => {
        globalThis.document = originals.document;
        globalThis.setInterval = originals.setInterval;
        globalThis.clearInterval = originals.clearInterval;
        audioUtils.isWhiteNoiseActive = originals.isWhiteNoiseActive;
        audioUtils.isWhiteNoisePending = originals.isWhiteNoisePending;
        audioUtils.whiteNoiseDesiredActive = originals.whiteNoiseDesiredActive;
        audioUtils.whiteNoiseOperationToken = originals.whiteNoiseOperationToken;
        audioUtils.whiteNoiseChannel = originals.whiteNoiseChannel;
        audioUtils.startWhiteNoise = originals.startWhiteNoise;
        audioUtils.stopWhiteNoise = originals.stopWhiteNoise;
        uiManager.showNotification = originals.showNotification;
    });

    let intervalCallback;
    let intervalClears = 0;
    let stopCalls = 0;
    let resolveStart;
    const starts = [];
    const button = { textContent: '' };
    const elements = {
        noiseChannelMode: radioGroup('auto'),
        noiseLevel: { value: '-12' },
        noiseChannel: radioGroup('left'),
        noiseToggleBtn: button
    };
    globalThis.document = { getElementById: id => elements[id] || null };
    globalThis.setInterval = callback => {
        intervalCallback = callback;
        return 17;
    };
    globalThis.clearInterval = id => { if (id === 17) intervalClears += 1; };
    audioUtils.isWhiteNoiseActive = true;
    audioUtils.isWhiteNoisePending = false;
    audioUtils.whiteNoiseDesiredActive = true;
    audioUtils.whiteNoiseOperationToken = 0;
    audioUtils.whiteNoiseChannel = 'left';
    audioUtils.startWhiteNoise = async (_level, _device, channel, minFreq, maxFreq) => {
        starts.push([channel, minFreq, maxFreq]);
        audioUtils.whiteNoiseOperationToken += 1;
        audioUtils.isWhiteNoisePending = true;
        return new Promise(resolve => { resolveStart = resolve; });
    };
    audioUtils.stopWhiteNoise = () => { stopCalls += 1; };
    const notifications = [];
    uiManager.showNotification = (...args) => notifications.push(args);
    const controller = {
        ...LevelAdjustment,
        measurementConfig: {
            audioOutputId: 'output',
            outputChannel: 'multi',
            outputChannels: ['left', '2']
        },
        currentMeasurement: { sweepBand: {
            mode: 'perChannel', common: { minFreq: 20, maxFreq: 20000 },
            perChannel: [{ channel: '2', minFreq: 2000, maxFreq: 10000 }]
        } },
        currentNoiseChannel: 'left',
        channelRotationEpoch: 0,
        channelRotationTimer: null,
        channelRotationTickInFlight: false
    };

    controller.startChannelRotation();
    const firstTick = intervalCallback();
    await Promise.resolve();
    const overlappingTick = intervalCallback();
    await overlappingTick;
    assert.deepEqual(starts, [['2', 2000, 10000]]);

    controller.stopChannelRotation();
    resolveStart(true);
    await firstTick;
    assert.equal(stopCalls, 0);
    assert.equal(controller.currentNoiseChannel, 'left');
    assert.equal(audioUtils.isWhiteNoisePending, false);
    assert.equal(audioUtils.whiteNoiseDesiredActive, true);
    assert.ok(intervalClears >= 1);
    assert.deepEqual(notifications, []);

    audioUtils.startWhiteNoise = async () => {
        audioUtils.whiteNoiseOperationToken += 1;
        audioUtils.isWhiteNoisePending = false;
        return false;
    };
    controller.startChannelRotation();
    await intervalCallback();
    assert.deepEqual(notifications.at(-1), [
        'The test signal could not be played. Check the audio output and try again.',
        'error'
    ]);
    assert.equal(audioUtils.isWhiteNoiseActive, true);
    assert.equal(audioUtils.whiteNoiseChannel, 'left');
    assert.equal(controller.currentNoiseChannel, 'left');
    assert.equal(elements.noiseChannel.querySelector().value, 'left');
    assert.equal(button.textContent, 'Stop test signal');
    assert.equal(controller.channelRotationTimer, null);
});

test('a pending test-signal request exposes Stop and settles as user cancellation', async t => {
    const originals = {
        document: globalThis.document,
        isWhiteNoiseActive: audioUtils.isWhiteNoiseActive,
        isWhiteNoisePending: audioUtils.isWhiteNoisePending,
        whiteNoiseDesiredActive: audioUtils.whiteNoiseDesiredActive,
        whiteNoiseOperationToken: audioUtils.whiteNoiseOperationToken,
        startWhiteNoise: audioUtils.startWhiteNoise,
        stopWhiteNoise: audioUtils.stopWhiteNoise,
        showNotification: uiManager.showNotification
    };
    t.after(() => {
        globalThis.document = originals.document;
        audioUtils.isWhiteNoiseActive = originals.isWhiteNoiseActive;
        audioUtils.isWhiteNoisePending = originals.isWhiteNoisePending;
        audioUtils.whiteNoiseDesiredActive = originals.whiteNoiseDesiredActive;
        audioUtils.whiteNoiseOperationToken = originals.whiteNoiseOperationToken;
        audioUtils.startWhiteNoise = originals.startWhiteNoise;
        audioUtils.stopWhiteNoise = originals.stopWhiteNoise;
        uiManager.showNotification = originals.showNotification;
    });
    const button = { textContent: '' };
    const elements = {
        noiseToggleBtn: button,
        noiseLevel: { value: '-12' },
        noiseChannel: radioGroup('left'),
        levelWarning: { classList: { remove() {} } }
    };
    globalThis.document = { getElementById: id => elements[id] || null };
    audioUtils.isWhiteNoiseActive = false;
    audioUtils.isWhiteNoisePending = false;
    audioUtils.whiteNoiseDesiredActive = false;
    audioUtils.whiteNoiseOperationToken = 0;
    let finishStart;
    let startCalls = 0;
    let stopCalls = 0;
    audioUtils.startWhiteNoise = () => {
        startCalls += 1;
        audioUtils.whiteNoiseOperationToken += 1;
        audioUtils.isWhiteNoisePending = true;
        audioUtils.whiteNoiseDesiredActive = true;
        return new Promise(resolve => { finishStart = resolve; });
    };
    audioUtils.stopWhiteNoise = () => {
        stopCalls += 1;
        audioUtils.whiteNoiseOperationToken += 1;
        audioUtils.isWhiteNoiseActive = false;
        audioUtils.isWhiteNoisePending = false;
        audioUtils.whiteNoiseDesiredActive = false;
    };
    const notifications = [];
    uiManager.showNotification = (...args) => notifications.push(args);
    const controller = {
        ...LevelAdjustment,
        measurementConfig: {
            audioOutputId: 'output',
            outputChannel: 'left'
        },
        currentMeasurement: { sweepMinFreq: 20, sweepMaxFreq: 20000 },
        channelRotationEpoch: 0,
        channelRotationTimer: null
    };

    const starting = controller.toggleWhiteNoise();
    assert.equal(button.textContent, 'Stop test signal');
    assert.equal(await controller.toggleWhiteNoise(), false);
    assert.equal(startCalls, 1);
    assert.equal(stopCalls, 1);
    assert.equal(button.textContent, 'Playback test signal for checking volume');

    finishStart(false);
    assert.equal(await starting, false);
    assert.deepEqual(notifications, []);
});

test('latest channel-switch failure retains published noise and reports the failure', async t => {
    const originals = {
        document: globalThis.document,
        isWhiteNoiseActive: audioUtils.isWhiteNoiseActive,
        isWhiteNoisePending: audioUtils.isWhiteNoisePending,
        whiteNoiseDesiredActive: audioUtils.whiteNoiseDesiredActive,
        whiteNoiseOperationToken: audioUtils.whiteNoiseOperationToken,
        whiteNoiseChannel: audioUtils.whiteNoiseChannel,
        startWhiteNoise: audioUtils.startWhiteNoise,
        cancelPendingWhiteNoiseStart: audioUtils.cancelPendingWhiteNoiseStart,
        showNotification: uiManager.showNotification
    };
    t.after(() => {
        globalThis.document = originals.document;
        audioUtils.isWhiteNoiseActive = originals.isWhiteNoiseActive;
        audioUtils.isWhiteNoisePending = originals.isWhiteNoisePending;
        audioUtils.whiteNoiseDesiredActive = originals.whiteNoiseDesiredActive;
        audioUtils.whiteNoiseOperationToken = originals.whiteNoiseOperationToken;
        audioUtils.whiteNoiseChannel = originals.whiteNoiseChannel;
        audioUtils.startWhiteNoise = originals.startWhiteNoise;
        audioUtils.cancelPendingWhiteNoiseStart = originals.cancelPendingWhiteNoiseStart;
        uiManager.showNotification = originals.showNotification;
    });
    const elements = {
        noiseLevel: { value: '-12' },
        noiseChannel: radioGroup('left'),
        noiseToggleBtn: { textContent: '' }
    };
    globalThis.document = { getElementById: id => elements[id] || null };
    audioUtils.isWhiteNoiseActive = true;
    audioUtils.isWhiteNoisePending = false;
    audioUtils.whiteNoiseDesiredActive = true;
    audioUtils.whiteNoiseOperationToken = 0;
    audioUtils.whiteNoiseChannel = 'left';
    audioUtils.startWhiteNoise = async () => {
        audioUtils.whiteNoiseOperationToken += 1;
        return false;
    };
    audioUtils.cancelPendingWhiteNoiseStart = () => {
        audioUtils.whiteNoiseOperationToken += 1;
        audioUtils.isWhiteNoisePending = false;
    };
    const notifications = [];
    uiManager.showNotification = (...args) => notifications.push(args);
    const controller = {
        ...LevelAdjustment,
        measurementConfig: {
            audioOutputId: 'output',
            outputChannel: 'multi',
            outputChannels: ['left', '2']
        },
        currentMeasurement: { sweepMinFreq: 20, sweepMaxFreq: 20000 },
        currentNoiseChannel: 'left',
        channelRotationEpoch: 0,
        channelRotationTimer: null
    };

    assert.equal(await controller.setNoiseChannel('2'), false);
    assert.deepEqual(notifications, [[
        'The test signal could not be played. Check the audio output and try again.',
        'error'
    ]]);
    assert.equal(audioUtils.isWhiteNoiseActive, true);
    assert.equal(controller.currentNoiseChannel, 'left');
    assert.equal(elements.noiseChannel.querySelector().value, 'left');
    assert.equal(elements.noiseToggleBtn.textContent, 'Stop test signal');

    notifications.length = 0;
    let finishStaleStart;
    audioUtils.startWhiteNoise = () => {
        audioUtils.whiteNoiseOperationToken += 1;
        return new Promise(resolve => { finishStaleStart = resolve; });
    };
    const staleSwitch = controller.setNoiseChannel('2');
    audioUtils.whiteNoiseOperationToken += 1;
    finishStaleStart(false);
    assert.equal(await staleSwitch, false);
    assert.deepEqual(notifications, []);
    assert.equal(controller.currentNoiseChannel, 'left');
});

test('auto mode preserves initial pending start and rotates after publication', async t => {
    const originals = {
        document: globalThis.document,
        setInterval: globalThis.setInterval,
        clearInterval: globalThis.clearInterval,
        isWhiteNoiseActive: audioUtils.isWhiteNoiseActive,
        isWhiteNoisePending: audioUtils.isWhiteNoisePending,
        whiteNoiseDesiredActive: audioUtils.whiteNoiseDesiredActive,
        whiteNoiseOperationToken: audioUtils.whiteNoiseOperationToken,
        whiteNoiseChannel: audioUtils.whiteNoiseChannel,
        startWhiteNoise: audioUtils.startWhiteNoise,
        cancelPendingWhiteNoiseStart: audioUtils.cancelPendingWhiteNoiseStart,
        showNotification: uiManager.showNotification
    };
    t.after(() => {
        globalThis.document = originals.document;
        globalThis.setInterval = originals.setInterval;
        globalThis.clearInterval = originals.clearInterval;
        audioUtils.isWhiteNoiseActive = originals.isWhiteNoiseActive;
        audioUtils.isWhiteNoisePending = originals.isWhiteNoisePending;
        audioUtils.whiteNoiseDesiredActive = originals.whiteNoiseDesiredActive;
        audioUtils.whiteNoiseOperationToken = originals.whiteNoiseOperationToken;
        audioUtils.whiteNoiseChannel = originals.whiteNoiseChannel;
        audioUtils.startWhiteNoise = originals.startWhiteNoise;
        audioUtils.cancelPendingWhiteNoiseStart = originals.cancelPendingWhiteNoiseStart;
        uiManager.showNotification = originals.showNotification;
    });
    const elements = {
        noiseChannelMode: radioGroup('auto'),
        noiseLevel: { value: '-12' },
        noiseChannel: radioGroup('left'),
        noiseToggleBtn: { textContent: '' }
    };
    globalThis.document = { getElementById: id => elements[id] || null };
    let intervalStarts = 0;
    globalThis.setInterval = () => {
        intervalStarts += 1;
        return 23;
    };
    globalThis.clearInterval = () => {};
    audioUtils.isWhiteNoiseActive = false;
    audioUtils.isWhiteNoisePending = false;
    audioUtils.whiteNoiseDesiredActive = false;
    audioUtils.whiteNoiseOperationToken = 0;
    audioUtils.whiteNoiseChannel = null;
    let finishStart;
    audioUtils.startWhiteNoise = () => {
        audioUtils.whiteNoiseOperationToken += 1;
        audioUtils.isWhiteNoisePending = true;
        audioUtils.whiteNoiseDesiredActive = true;
        return new Promise(resolve => { finishStart = resolve; });
    };
    let pendingCancels = 0;
    audioUtils.cancelPendingWhiteNoiseStart = () => { pendingCancels += 1; };
    uiManager.showNotification = () => {};
    const controller = {
        ...LevelAdjustment,
        measurementConfig: {
            audioOutputId: 'output',
            outputChannel: 'multi',
            outputChannels: ['left', '2']
        },
        currentMeasurement: { sweepMinFreq: 20, sweepMaxFreq: 20000 },
        currentNoiseChannel: 'left',
        channelRotationEpoch: 0,
        channelRotationTimer: null,
        channelRotationTickInFlight: false
    };

    const starting = controller.toggleWhiteNoise();
    controller.startChannelRotation();
    assert.equal(pendingCancels, 0);
    assert.equal(intervalStarts, 0);

    audioUtils.isWhiteNoiseActive = true;
    audioUtils.isWhiteNoisePending = false;
    audioUtils.whiteNoiseChannel = 'left';
    finishStart(true);
    assert.equal(await starting, true);
    assert.equal(pendingCancels, 0);
    assert.equal(intervalStarts, 1);
    assert.equal(controller.channelRotationTimer, 23);
});

test('measurement start invalidates pending auto noise before sweep output setup', async t => {
    const originals = {
        document: globalThis.document,
        isWhiteNoiseActive: audioUtils.isWhiteNoiseActive,
        isWhiteNoisePending: audioUtils.isWhiteNoisePending,
        whiteNoiseDesiredActive: audioUtils.whiteNoiseDesiredActive,
        stopWhiteNoise: audioUtils.stopWhiteNoise,
        waitForWhiteNoiseRouteIdle: audioUtils.waitForWhiteNoiseRouteIdle,
        showScreen: uiManager.showScreen
    };
    t.after(() => {
        globalThis.document = originals.document;
        audioUtils.isWhiteNoiseActive = originals.isWhiteNoiseActive;
        audioUtils.isWhiteNoisePending = originals.isWhiteNoisePending;
        audioUtils.whiteNoiseDesiredActive = originals.whiteNoiseDesiredActive;
        audioUtils.stopWhiteNoise = originals.stopWhiteNoise;
        audioUtils.waitForWhiteNoiseRouteIdle = originals.waitForWhiteNoiseRouteIdle;
        uiManager.showScreen = originals.showScreen;
    });
    const elements = createSweepTestElements();
    globalThis.document = { getElementById: id => elements.get(id) || null };
    audioUtils.isWhiteNoiseActive = false;
    audioUtils.isWhiteNoisePending = true;
    audioUtils.whiteNoiseDesiredActive = true;
    uiManager.showScreen = () => {};
    const events = [];
    audioUtils.stopWhiteNoise = () => {
        events.push('stop-noise');
        audioUtils.isWhiteNoisePending = false;
        audioUtils.whiteNoiseDesiredActive = false;
    };
    let releaseRoute;
    audioUtils.waitForWhiteNoiseRouteIdle = () => new Promise(resolve => {
        releaseRoute = resolve;
    });
    const controller = {
        ...SweepMeasurement,
        stopLevelMeter() { events.push('stop-meter'); },
        stopChannelRotation() { events.push('stop-rotation'); },
        performSweepMeasurement() { events.push('perform-sweep'); }
    };

    const starting = controller.startSweepMeasurement();
    assert.deepEqual(events, ['stop-meter', 'stop-rotation', 'stop-noise']);
    assert.equal(audioUtils.isWhiteNoisePending, false);

    releaseRoute();
    await starting;
    assert.deepEqual(events, [
        'stop-meter',
        'stop-rotation',
        'stop-noise',
        'perform-sweep'
    ]);
});

test('redo controls follow running, single-channel, multi-channel, and redo states', async t => {
    const originals = {
        document: globalThis.document,
        setInterval: globalThis.setInterval,
        clearInterval: globalThis.clearInterval,
        audioContext: audioUtils.audioContext,
        microphone: audioUtils.microphone,
        generateTSP: audioUtils.generateTSP,
        showNotification: uiManager.showNotification
    };
    t.after(() => {
        globalThis.document = originals.document;
        globalThis.setInterval = originals.setInterval;
        globalThis.clearInterval = originals.clearInterval;
        audioUtils.audioContext = originals.audioContext;
        audioUtils.microphone = originals.microphone;
        audioUtils.generateTSP = originals.generateTSP;
        uiManager.showNotification = originals.showNotification;
    });

    const elements = createSweepTestElements();
    const redoControls = ['redoChannelLabel', 'redoChannelSelect', 'redoChannelBtn'];
    globalThis.document = { getElementById: id => elements.get(id) || null };
    globalThis.setInterval = () => 41;
    globalThis.clearInterval = () => {};
    audioUtils.audioContext = { state: 'running', sampleRate: 48000 };
    audioUtils.microphone = {};
    audioUtils.generateTSP = () => ({ length: 8 });
    uiManager.showNotification = () => {};

    let releaseFirstChannel;
    let playCalls = 0;
    const result = { frequencyResponse: [[100, 0]], maxSignalLevel: -20 };
    const multiController = {
        ...SweepMeasurement,
        measurementConfig: {
            ...measurementConfig(),
            outputChannel: 'multi',
            outputChannels: ['left', '2']
        },
        currentMeasurement: {
            id: 'multi-controls',
            points: [],
            nextPointId: 0,
            sweepMinFreq: 20,
            sweepMaxFreq: 20000
        },
        updateLevelGraph() {},
        drawLevelGraphGrid() {},
        updateFrequencyResponseGraph() {},
        playAndRecordSweep() {
            playCalls += 1;
            if (playCalls === 1) {
                return new Promise(resolve => { releaseFirstChannel = () => resolve(result); });
            }
            return Promise.resolve(result);
        }
    };

    const runningMeasurement = multiController.performSweepMeasurement();
    assert.ok(redoControls.every(id => elements.get(id).hidden));
    releaseFirstChannel();
    await runningMeasurement;
    assert.ok(redoControls.every(id => !elements.get(id).hidden));

    const singleController = {
        ...multiController,
        measurementConfig: measurementConfig(),
        currentMeasurement: {
            id: 'single-controls',
            points: [],
            nextPointId: 0,
            sweepMinFreq: 20,
            sweepMaxFreq: 20000
        },
        playAndRecordSweep: async () => result
    };
    await singleController.performSweepMeasurement();
    assert.ok(redoControls.every(id => elements.get(id).hidden));

    let rejectRedo;
    const redoPoint = {
        pointId: 1,
        channels: [
            { channel: 'left', frequencyResponse: [[100, 0]], maxSignalLevel: -20 },
            { channel: '2', frequencyResponse: [[100, 1]], maxSignalLevel: -19 }
        ]
    };
    const redoController = {
        ...multiController,
        currentPoint: redoPoint,
        currentImpulseResponses: [],
        playAndRecordSweep: () => new Promise((_, reject) => { rejectRedo = reject; })
    };
    const redo = redoController.redoChannel('left');
    assert.ok(redoControls.every(id => elements.get(id).hidden));
    rejectRedo(new Error('Simulated redo failure'));
    assert.equal(await redo, false);
    assert.ok(redoControls.every(id => !elements.get(id).hidden));
});

test('active sweep cancellation rejects once and releases every sweep timer', t => {
    const originalClearTimeout = globalThis.clearTimeout;
    const originalClearInterval = globalThis.clearInterval;
    t.after(() => {
        globalThis.clearTimeout = originalClearTimeout;
        globalThis.clearInterval = originalClearInterval;
    });
    const clearedTimeouts = [];
    const clearedIntervals = [];
    globalThis.clearTimeout = id => clearedTimeouts.push(id);
    globalThis.clearInterval = id => clearedIntervals.push(id);
    const rejected = [];
    const operation = {
        settled: false,
        reject: error => rejected.push(error)
    };
    const controller = {
        ...AudioProcessing,
        activeSweepOperation: operation,
        activeSweepElements: {
            preRollTimer: 11,
            playbackSafetyTimer: 12,
            finishTimer: 13,
            finalSafetyTimer: 14,
            checkInterval: 15,
            source: null,
            gainNode: null,
            recordNode: null,
            analyzer: null,
            audioElement: null,
            mediaStreamDestination: null,
            operation
        }
    };

    controller.cancelActiveSweep();
    controller.cancelActiveSweep();

    assert.equal(rejected.length, 1);
    assert.ok(rejected[0] instanceof SweepCancelledError);
    assert.deepEqual(clearedTimeouts, [11, 12, 13, 14]);
    assert.deepEqual(clearedIntervals, [15]);
    assert.equal(controller.activeSweepOperation, null);
});

test('a cancelled sweep setup rejection preserves the newer sweep owner', async t => {
    const originals = {
        document: globalThis.document,
        audioContext: audioUtils.audioContext,
        microphone: audioUtils.microphone,
        audioWorkletSupported: audioUtils.audioWorkletSupported,
        createRecorderWorkletNode: audioUtils.createRecorderWorkletNode
    };
    t.after(() => {
        globalThis.document = originals.document;
        audioUtils.audioContext = originals.audioContext;
        audioUtils.microphone = originals.microphone;
        audioUtils.audioWorkletSupported = originals.audioWorkletSupported;
        audioUtils.createRecorderWorkletNode = originals.createRecorderWorkletNode;
    });
    globalThis.document = {
        getElementById: id => id === 'noiseLevel' ? { value: '-12' } : null
    };
    const analyzers = [];
    const audioContext = {
        state: 'running',
        sampleRate: 8,
        destination: {
            maxChannelCount: 2,
            channelCount: 2,
            channelCountMode: 'max',
            channelInterpretation: 'speakers'
        },
        createBuffer(channelCount, length) {
            const channels = Array.from({ length: channelCount }, () => new Float32Array(length));
            return { getChannelData: channel => channels[channel] };
        },
        createAnalyser() {
            const analyzer = {
                frequencyBinCount: 4,
                disconnected: false,
                disconnect() { this.disconnected = true; }
            };
            analyzers.push(analyzer);
            return analyzer;
        }
    };
    audioUtils.audioContext = audioContext;
    audioUtils.microphone = {};
    audioUtils.audioWorkletSupported = true;
    const recorderRejectors = [];
    audioUtils.createRecorderWorkletNode = () => new Promise((_, reject) => {
        recorderRejectors.push(reject);
    });
    const controller = {
        ...AudioProcessing,
        measurementConfig: {
            audioOutputId: null,
            outputChannel: 'left',
            averaging: 1
        },
        activeSweepOperation: null,
        activeSweepElements: null,
        recorderNode: null
    };
    const sweepBuffer = {
        length: 8,
        channels: [new Float32Array(8), new Float32Array(8)]
    };

    const earlier = controller.playAndRecordSweep(sweepBuffer, 'left');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(recorderRejectors.length, 1);
    const earlierOperation = controller.activeSweepOperation;
    controller.cancelActiveSweep();
    await assert.rejects(earlier, SweepCancelledError);

    const latest = controller.playAndRecordSweep(sweepBuffer, 'left');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(recorderRejectors.length, 2);
    const latestOperation = controller.activeSweepOperation;
    assert.notStrictEqual(latestOperation, earlierOperation);

    recorderRejectors[0](new Error('Earlier setup failed after cancellation'));
    await new Promise(resolve => setImmediate(resolve));
    assert.strictEqual(controller.activeSweepOperation, latestOperation);
    assert.strictEqual(controller.activeSweepElements.operation, latestOperation);
    assert.equal(analyzers[1].disconnected, false);

    controller.cancelActiveSweep();
    await assert.rejects(latest, SweepCancelledError);
    recorderRejectors[1](new Error('Latest setup released after cancellation'));
    await new Promise(resolve => setImmediate(resolve));
});

test('internal sweep errors reach the measurement failure path during cancellation state', async t => {
    const originals = {
        document: globalThis.document,
        setInterval: globalThis.setInterval,
        clearInterval: globalThis.clearInterval,
        audioContext: audioUtils.audioContext,
        microphone: audioUtils.microphone,
        generateTSP: audioUtils.generateTSP,
        showNotification: uiManager.showNotification
    };
    t.after(() => {
        globalThis.document = originals.document;
        globalThis.setInterval = originals.setInterval;
        globalThis.clearInterval = originals.clearInterval;
        audioUtils.audioContext = originals.audioContext;
        audioUtils.microphone = originals.microphone;
        audioUtils.generateTSP = originals.generateTSP;
        uiManager.showNotification = originals.showNotification;
    });
    const elements = createSweepTestElements();
    globalThis.document = { getElementById: id => elements.get(id) || null };
    globalThis.setInterval = () => 51;
    globalThis.clearInterval = () => {};
    audioUtils.audioContext = { state: 'running', sampleRate: 48000 };
    audioUtils.microphone = {};
    audioUtils.generateTSP = () => ({ length: 8 });
    const notifications = [];
    uiManager.showNotification = (...args) => notifications.push(args);
    const controller = {
        ...SweepMeasurement,
        measurementConfig: measurementConfig(),
        currentMeasurement: {
            points: [],
            sweepMinFreq: 20,
            sweepMaxFreq: 20000
        },
        sweepCancelRequested: false,
        updateLevelGraph() {},
        drawLevelGraphGrid() {},
        playAndRecordSweep: () => new Promise((_, reject) => {
            controller.sweepCancelRequested = true;
            reject(new Error('Simulated internal failure'));
        })
    };

    await controller.performSweepMeasurement();

    assert.equal(notifications.length, 1);
    assert.equal(notifications[0][1], 'error');
});

test('channel redo commits one replacement and preserves prior state for failure and cancellation', async t => {
    const originals = {
        document: globalThis.document,
        audioContext: audioUtils.audioContext,
        generateTSP: audioUtils.generateTSP,
        showNotification: uiManager.showNotification
    };
    t.after(() => {
        globalThis.document = originals.document;
        audioUtils.audioContext = originals.audioContext;
        audioUtils.generateTSP = originals.generateTSP;
        uiManager.showNotification = originals.showNotification;
    });
    const elements = createSweepTestElements();
    globalThis.document = { getElementById: id => elements.get(id) || null };
    audioUtils.audioContext = { sampleRate: 48000 };
    audioUtils.generateTSP = (_length, _sampleRate, _channel, minFreq, maxFreq) => {
        assert.equal(minFreq, 40);
        assert.equal(maxFreq, 400);
        return { length: 8 };
    };
    const notifications = [];
    uiManager.showNotification = (...args) => notifications.push(args);

    function createRedoController(playAndRecordSweep) {
        const currentPoint = {
            pointId: 4,
            name: 'Point 5',
            channels: [
                {
                    channel: 'left',
                    frequencyResponse: [[100, 0]],
                    maxSignalLevel: -20,
                    irId: 10,
                    ir: { stored: true, length: 2, sampleRate: 48000, onsetIndex: 0 }
                },
                {
                    channel: '2',
                    frequencyResponse: [[100, 2]],
                    maxSignalLevel: -18,
                    irId: 11,
                    ir: { stored: true, length: 2, sampleRate: 48000, onsetIndex: 0 }
                }
            ]
        };
        const currentImpulseResponses = [
            { measurementId: 'redo', pointId: 10, channel: 'left', data: Float32Array.of(1) },
            { measurementId: 'redo', pointId: 11, channel: '2', data: Float32Array.of(2) }
        ];
        return {
            controller: {
                ...SweepMeasurement,
                measurementConfig: {
                    ...measurementConfig(),
                    outputChannel: 'multi',
                    outputChannels: ['left', '2']
                },
                currentMeasurement: {
                    id: 'redo',
                    nextPointId: 12,
                    sweepBand: { mode: 'perChannel', common: { minFreq: 20, maxFreq: 20000 },
                        perChannel: [{ channel: 'left', minFreq: 40, maxFreq: 400 }] },
                    sweepMinFreq: 20,
                    sweepMaxFreq: 20000
                },
                currentPoint,
                currentImpulseResponses,
                playAndRecordSweep,
                updateLevelGraph() {},
                updateFrequencyResponseGraph() {}
            },
            currentPoint,
            currentImpulseResponses
        };
    }

    const replacement = {
        frequencyResponse: [[100, 5]],
        maxSignalLevel: -15,
        irValid: true,
        impulseResponse: Float32Array.of(0.5, 1),
        sampleRate: 48000,
        onsetIndex: 1,
        prerollSamples: 2,
        refScale: 0.5,
        peakDb: -3,
        sweepLimited: true
    };
    const success = createRedoController(async () => replacement);
    const untouchedChannel = success.currentPoint.channels[1];
    assert.equal(await success.controller.redoChannel('left'), true);
    assert.strictEqual(success.controller.currentPoint.channels[1], untouchedChannel);
    assert.deepEqual(success.controller.currentPoint.channels[0].frequencyResponse, [[100, 5]]);
    assert.equal(success.controller.currentImpulseResponses.length, 2);
    assert.deepEqual(
        success.controller.currentImpulseResponses.find(record => record.channel === '2'),
        success.currentImpulseResponses[1]
    );

    for (const error of [new Error('Simulated redo failure'), new SweepCancelledError()]) {
        const scenario = createRedoController(async () => { throw error; });
        const nextPointId = scenario.controller.currentMeasurement.nextPointId;
        assert.equal(await scenario.controller.redoChannel('left'), false);
        assert.strictEqual(scenario.controller.currentPoint, scenario.currentPoint);
        assert.strictEqual(
            scenario.controller.currentImpulseResponses,
            scenario.currentImpulseResponses
        );
        assert.equal(scenario.controller.currentMeasurement.nextPointId, nextPointId);
    }
    const renderFailure = createRedoController(async () => replacement);
    renderFailure.controller.updateFrequencyResponseGraph = () => {
        throw new Error('Simulated graph failure');
    };
    assert.equal(await renderFailure.controller.redoChannel('left'), false);
    assert.strictEqual(renderFailure.controller.currentPoint, renderFailure.currentPoint);
    assert.strictEqual(
        renderFailure.controller.currentImpulseResponses,
        renderFailure.currentImpulseResponses
    );
    assert.equal(renderFailure.controller.currentMeasurement.nextPointId, 12);
    assert.equal(notifications.length, 2);
});

test('per-channel sweeps resolve bands, reset the level graph and retain calibrations', async t => {
    const originals = {
        document: globalThis.document,
        setInterval: globalThis.setInterval,
        clearInterval: globalThis.clearInterval,
        audioContext: audioUtils.audioContext,
        microphone: audioUtils.microphone,
        generateTSP: audioUtils.generateTSP,
        stopWhiteNoise: audioUtils.stopWhiteNoise,
        stopMicrophoneInput: audioUtils.stopMicrophoneInput
    };
    t.after(() => {
        globalThis.document = originals.document;
        globalThis.setInterval = originals.setInterval;
        globalThis.clearInterval = originals.clearInterval;
        audioUtils.audioContext = originals.audioContext;
        audioUtils.microphone = originals.microphone;
        audioUtils.generateTSP = originals.generateTSP;
        audioUtils.stopWhiteNoise = originals.stopWhiteNoise;
        audioUtils.stopMicrophoneInput = originals.stopMicrophoneInput;
    });
    const elements = createSweepTestElements();
    globalThis.document = { getElementById: id => elements.get(id) || null };
    globalThis.setInterval = () => 61;
    globalThis.clearInterval = () => {};
    audioUtils.audioContext = { state: 'running', sampleRate: 48000 };
    audioUtils.microphone = {};
    const leftCalibration = { data: Float32Array.of(1) };
    const thirdCalibration = { data: Float32Array.of(3) };
    const calibrationMap = new Map([
        ['left', leftCalibration],
        ['2', thirdCalibration]
    ]);
    const observed = [];
    const bands = [];
    const graphTimes = [];
    let now = 10000;
    t.mock.method(Date, 'now', () => now);
    let controller;
    audioUtils.generateTSP = (_length, _sampleRate, channel, minFreq, maxFreq) => {
        observed.push(['generate', channel, controller.interfaceCalibrationImpulseResponse]);
        bands.push([channel, minFreq, maxFreq]);
        return { length: 8 };
    };
    controller = {
        ...SweepMeasurement,
        measurementConfig: {
            ...measurementConfig(),
            outputChannel: 'multi',
            outputChannels: ['left', '2']
        },
        currentMeasurement: {
            id: 'calibrated-multi',
            points: [],
            nextPointId: 0,
            sweepBand: { mode: 'perChannel', common: { minFreq: 20, maxFreq: 20000 },
                perChannel: [
                    { channel: 'left', minFreq: 40, maxFreq: 400 },
                    { channel: '2', minFreq: 2000, maxFreq: 10000 }
                ] },
            sweepMinFreq: 20,
            sweepMaxFreq: 20000
        },
        interfaceCalibrationImpulseResponsesByChannel: calibrationMap,
        interfaceCalibrationImpulseResponse: null,
        updateLevelGraph() {
            assert.deepEqual(this.levelGraphData, []);
            graphTimes.push(this.startTime);
            this.levelGraphData.push({ time: 0, level: -20 });
        },
        drawLevelGraphGrid() {},
        updateFrequencyResponseGraph() {},
        async playAndRecordSweep(_buffer, channel) {
            observed.push(['play', channel, this.interfaceCalibrationImpulseResponse]);
            now += 10000;
            return { frequencyResponse: [[100, 0]], maxSignalLevel: -20 };
        }
    };

    await controller.performSweepMeasurement();

    assert.deepEqual(observed, [
        ['generate', 'left', leftCalibration],
        ['play', 'left', leftCalibration],
        ['generate', '2', thirdCalibration],
        ['play', '2', thirdCalibration]
    ]);
    assert.strictEqual(controller.interfaceCalibrationImpulseResponse, thirdCalibration);
    assert.deepEqual(bands, [['left', 40, 400], ['2', 2000, 10000]]);
    assert.deepEqual(graphTimes, [10000, 20000]);

    audioUtils.stopWhiteNoise = () => {};
    audioUtils.stopMicrophoneInput = () => {};
    audioUtils.audioContext = null;
    const cleanupController = new MeasurementController();
    cleanupController.interfaceCalibrationImpulseResponsesByChannel = calibrationMap;
    cleanupController.cleanup();
    assert.strictEqual(cleanupController.interfaceCalibrationImpulseResponsesByChannel, calibrationMap);
});

function calibrationSource(overrides = {}) {
    return {
        id: 'measurement-calibration',
        name: 'Interface loopback',
        timestamp: '2026-07-24T12:00:00.000Z',
        sampleRate: 48000,
        sweepMinFreq: 20,
        sweepMaxFreq: 20000,
        points: [{
            pointId: 3,
            name: 'Loopback left',
            frequencyResponse: [[100, 0]],
            ir: { stored: true }
        }],
        ...overrides
    };
}

function calibrationImpulse(overrides = {}) {
    return {
        measurementId: 'measurement-calibration',
        pointId: 3,
        sampleRate: 48000,
        onsetIndex: 1,
        prerollSamples: 1,
        refScale: 0.5,
        data: Float32Array.from([0.1, 1, 0.2]),
        ...overrides
    };
}

function installMeasurementStartEnvironment(t, source, impulse) {
    const originals = {
        audioContext: audioUtils.audioContext,
        getMeasurementById: dataStorage.getMeasurementById,
        getImpulseResponse: dataStorage.getImpulseResponse,
        generateId: dataStorage.generateId,
        document: globalThis.document
    };
    t.after(() => {
        audioUtils.audioContext = originals.audioContext;
        dataStorage.getMeasurementById = originals.getMeasurementById;
        dataStorage.getImpulseResponse = originals.getImpulseResponse;
        dataStorage.generateId = originals.generateId;
        globalThis.document = originals.document;
    });
    audioUtils.audioContext = { sampleRate: 48000, state: 'running' };
    dataStorage.getMeasurementById = () => source;
    dataStorage.getImpulseResponse = async () => impulse;
    dataStorage.generateId = () => 'measurement-new';
    const elements = new Map([
        ['measurementResults', { style: {} }],
        ['noMeasurementMessage', { style: {} }]
    ]);
    globalThis.document = { getElementById: id => elements.get(id) || null };
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

    const sweepLength = 8;
    const sampleRate = 16;
    const capturePlan = createSweepCapturePlan(sweepLength, 1, sampleRate);
    const preRollSamples = sampleRate / 2;
    const fullRecording = new Float32Array(
        preRollSamples + capturePlan.analysisStartSamples + sweepLength
    );
    fullRecording[preRollSamples + capturePlan.analysisStartSamples] = 1;
    const cases = [
        {
            label: 'missing inverse',
            inverse: null,
            recording: fullRecording,
            sweepLength,
            sampleRate
        },
        {
            label: 'empty inverse',
            inverse: new Float32Array(0),
            recording: fullRecording,
            sweepLength,
            sampleRate
        },
        {
            label: 'deconvolution exception',
            inverse: { length: Symbol('invalid') },
            recording: fullRecording,
            sweepLength,
            sampleRate
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

test('calibrated measurement start is single-flight and snapshots valid source data', async t => {
    const source = calibrationSource();
    const impulse = calibrationImpulse();
    installMeasurementStartEnvironment(t, source, impulse);
    let resolvePreparation;
    const preparation = new Promise(resolve => { resolvePreparation = resolve; });
    let impulseReads = 0;
    let preparationCalls = 0;
    dataStorage.getImpulseResponse = async () => {
        impulseReads += 1;
        return impulse;
    };
    const controller = new MeasurementController();
    controller.prepareForLevelAdjustment = async () => {
        preparationCalls += 1;
        await preparation;
    };
    const config = measurementConfig({
        sourceMeasurementId: source.id,
        sourcePointId: 3
    });

    const first = controller.startNewMeasurement(config);
    const second = controller.startNewMeasurement(structuredClone(config));
    assert.strictEqual(second, first);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(impulseReads, 1);
    assert.equal(preparationCalls, 1);
    resolvePreparation();
    const measurement = await first;

    assert.equal(measurement.interfaceCalibration.sourceMeasurementName, source.name);
    assert.equal(measurement.interfaceCalibration.sourcePointName, 'Loopback left');
    assert.equal(measurement.interfaceCalibration.sourceTimestamp, source.timestamp);
    assert.equal(measurement.interfaceCalibration.sampleRate, 48000);
    assert.notStrictEqual(controller.interfaceCalibrationImpulseResponse.data, impulse.data);
    assert.deepEqual(controller.interfaceCalibrationImpulseResponse.data, impulse.data);
    assert.equal(controller.startMeasurementPromise, null);
});

test('imported stereo calibration resolves the selected channel IR and records its provenance', async t => {
    const imported = createImpulseResponseMeasurement({
        id: 'measurement-imported-stereo',
        name: 'Imported loopback',
        channels: [Float32Array.of(1, 0), Float32Array.of(0.25, 1)],
        sampleRate: 48000,
        timestamp: '2026-08-27T00:00:00.000Z'
    });
    const selected = imported.records.find(record => record.channel === 'right');
    installMeasurementStartEnvironment(t, imported.measurement, selected);
    const requestedIrKeys = [];
    dataStorage.getImpulseResponse = async (_measurementId, irKey) => {
        requestedIrKeys.push(irKey);
        return imported.records.find(record => record.pointId === irKey) || null;
    };
    const controller = new MeasurementController();
    controller.prepareForLevelAdjustment = async () => {};

    const measurement = await controller.startNewMeasurement(measurementConfig({
        sourceMeasurementId: imported.measurement.id,
        sourcePointId: 0,
        sourceChannel: 'right'
    }));

    assert.deepEqual(requestedIrKeys, [selected.pointId]);
    assert.deepEqual(controller.interfaceCalibrationImpulseResponse.data, selected.data);
    assert.equal(measurement.interfaceCalibration.sourcePointId, 0);
    assert.equal(measurement.interfaceCalibration.sourceChannel, 'right');
});

test('uncalibrated start does not read calibration IR or add provenance', async t => {
    installMeasurementStartEnvironment(t, null, null);
    let impulseReads = 0;
    dataStorage.getImpulseResponse = async () => {
        impulseReads += 1;
        return null;
    };
    const controller = new MeasurementController();
    controller.prepareForLevelAdjustment = async () => {};

    const measurement = await controller.startNewMeasurement(measurementConfig());
    assert.equal(impulseReads, 0);
    assert.equal(measurement.interfaceCalibration, undefined);
    assert.equal(controller.interfaceCalibrationImpulseResponse, null);
});

test('unlimited sweep records the full FFT bandwidth', async t => {
    installMeasurementStartEnvironment(t, null, null);
    const controller = new MeasurementController();
    controller.prepareForLevelAdjustment = async () => {};
    const config = measurementConfig();
    config.sweepBand = { mode: 'off', common: { minFreq: 20, maxFreq: 20000 }, perChannel: [] };

    const measurement = await controller.startNewMeasurement(config);
    const fftLength = Number(config.sweepLength);

    assert.equal(measurement.sweepBandLimited, false);
    assert.equal(measurement.sweepMinFreq, 48000 / fftLength);
    assert.equal(
        measurement.sweepMaxFreq,
        (fftLength / 2 - 1) * 48000 / fftLength
    );
});

test('channel calibration accepts matching bands and rejects an undersized common band', async t => {
    const lowSource = calibrationSource({ id: 'low', outputChannel: 'left', sweepBand: {
        mode: 'perChannel', common: { minFreq: 20, maxFreq: 20000 },
        perChannel: [{ channel: 'left', minFreq: 40, maxFreq: 400 }]
    } });
    const highSource = calibrationSource({ id: 'high', sweepMinFreq: 2000, sweepMaxFreq: 10000 });
    installMeasurementStartEnvironment(t, lowSource, calibrationImpulse());
    dataStorage.getMeasurementById = id => id === 'low' ? lowSource : highSource;
    const controller = new MeasurementController();
    controller.prepareForLevelAdjustment = async () => {};
    const config = { ...measurementConfig(), outputChannel: 'multi', outputChannels: ['left', '2'],
        sweepBand: { mode: 'perChannel', common: { minFreq: 20, maxFreq: 20000 }, perChannel: [
            { channel: 'left', minFreq: 40, maxFreq: 400 },
            { channel: '2', minFreq: 2000, maxFreq: 10000 }
        ] },
        interfaceCalibrations: [
            { channel: 'left', sourceMeasurementId: 'low', sourcePointId: 3 },
            { channel: '2', sourceMeasurementId: 'high', sourcePointId: 3 }
        ]
    };
    const measurement = await controller.startNewMeasurement(config);
    assert.deepEqual(measurement.sweepBand, config.sweepBand);
    assert.equal(measurement.sweepMinFreq, 40);
    assert.equal(measurement.sweepMaxFreq, 10000);
    assert.equal(measurement.interfaceCalibrations.length, 2);
    delete config.interfaceCalibrations;
    config.interfaceCalibration = { sourceMeasurementId: 'low', sourcePointId: 3 };
    await assert.rejects(controller.startNewMeasurement(config),
        error => error.code === 'interfaceCalibrationSweepRangeMismatch');
});

test('simultaneous stereo measurement keeps calibration and signals within connected outputs', async t => {
    const sweepBand = { mode: 'perChannel', common: { minFreq: 20, maxFreq: 20000 }, perChannel: [
        { channel: 'left', minFreq: 40, maxFreq: 200 },
        { channel: 'right', minFreq: 200, maxFreq: 400 }
    ] };
    const source = calibrationSource({ outputChannel: 'all', outputChannelCount: 2, sweepBand });
    installMeasurementStartEnvironment(t, source, calibrationImpulse());
    const context = audioUtils.audioContext;
    context.destination = { maxChannelCount: 8, channelCount: 2 };
    context.sinkId = '';
    context.setSinkId = async id => {
        assert.equal(id, 'output-id');
        context.sinkId = id;
        context.destination.maxChannelCount = 2;
    };
    const controller = new MeasurementController();
    controller.prepareForLevelAdjustment = async () => {};
    const config = { ...measurementConfig({ sourceMeasurementId: source.id, sourcePointId: 3 }),
        outputChannel: 'all', sweepBand };
    const measurement = await controller.startNewMeasurement(config);
    assert.equal(measurement.outputChannelCount, 2);
    assert.equal(controller.measurementConfig.outputChannelCount, 2);
    assert.equal(measurement.sweepMinFreq, 40);
    assert.equal(measurement.sweepMaxFreq, 400);
    const elements = createSweepTestElements();
    elements.set('noiseLevel', { value: '-12' });
    globalThis.document = { getElementById: id => elements.get(id) || null };
    const checkSignal = (channel, minFreq, maxFreq, bands) => {
        assert.equal(channel, 'all');
        assert.equal(minFreq, 40);
        assert.equal(maxFreq, 400);
        assert.deepEqual(bands.map(band => band.channel), ['left', 'right']);
    };
    t.mock.method(audioUtils, 'generateTSP', (_length, _rate, channel, minFreq, maxFreq, _limited, bands) => {
        checkSignal(channel, minFreq, maxFreq, bands);
        return { length: 8 };
    });
    t.mock.method(audioUtils, 'startWhiteNoise', async (_level, _device, channel, minFreq, maxFreq, bands) => {
        checkSignal(channel, minFreq, maxFreq, bands);
        return true;
    });
    await controller.restartWhiteNoiseForChannel('all');
    t.mock.method(controller, 'updateLevelGraph', () => {});
    t.mock.method(controller, 'drawLevelGraphGrid', () => {});
    t.mock.method(controller, 'updateFrequencyResponseGraph', () => {});
    const previousMicrophone = audioUtils.microphone;
    audioUtils.microphone = {};
    t.after(() => { audioUtils.microphone = previousMicrophone; });
    let sweeps = 0;
    controller.playAndRecordSweep = async (_buffer, channel, width) => {
        assert.equal(channel, 'all');
        assert.equal(width, 2);
        sweeps += 1;
        return { frequencyResponse: [[100, 0]], maxSignalLevel: -20 };
    };
    await controller.performSweepMeasurement();
    assert.equal(sweeps, 1);
});

test('stereo route probing releases temporary playback before calibration rejection', async t => {
    const source = calibrationSource({ sweepMinFreq: 80 });
    installMeasurementStartEnvironment(t, source, calibrationImpulse());
    const previousAudio = globalThis.Audio;
    t.after(() => { globalThis.Audio = previousAudio; });
    let pauses = 0, disconnects = 0;
    globalThis.Audio = class {
        async setSinkId() {}
        async play() {}
        pause() { pauses += 1; }
    };
    audioUtils.audioContext.destination = { maxChannelCount: 8, channelCount: 2 };
    audioUtils.audioContext.createMediaStreamDestination = () => ({
        stream: {}, disconnect() { disconnects += 1; }
    });
    const controller = new MeasurementController();
    const config = { ...measurementConfig({ sourceMeasurementId: source.id, sourcePointId: 3 }),
        outputChannel: 'all', sweepBand: {
            mode: 'perChannel', common: { minFreq: 40, maxFreq: 400 }, perChannel: []
        } };
    await assert.rejects(controller.startNewMeasurement(config),
        error => error.code === 'interfaceCalibrationSweepRangeMismatch');
    assert.equal(pauses, 1);
    assert.equal(disconnects, 1);
});

test('calibration validation rejects corrected, missing, non-finite, mismatched, and narrow sources', async t => {
    const source = calibrationSource();
    const impulse = calibrationImpulse();
    installMeasurementStartEnvironment(t, source, impulse);
    const selection = {
        sourceMeasurementId: source.id,
        sourcePointId: 3
    };
    const cases = [
        {
            code: 'interfaceCalibrationUnavailable',
            source: calibrationSource({ interfaceCalibration: {
                sourceMeasurementId: 'older'
            } }),
            impulse
        },
        {
            code: 'interfaceCalibrationUnavailable',
            source,
            impulse: null
        },
        {
            code: 'interfaceCalibrationUnavailable',
            source,
            impulse: calibrationImpulse({
                data: Float32Array.from([0.1, Number.NaN, 0.2])
            })
        },
        {
            code: 'interfaceCalibrationUnavailable',
            source,
            impulse: calibrationImpulse({
                data: Float32Array.from([0.1, Number.POSITIVE_INFINITY, 0.2])
            })
        },
        {
            code: 'interfaceCalibrationUnavailable',
            source,
            impulse: calibrationImpulse({
                data: Float32Array.from([0.1, Number.NEGATIVE_INFINITY, 0.2])
            })
        },
        {
            code: 'interfaceCalibrationSampleRateMismatch',
            source,
            impulse: calibrationImpulse({ sampleRate: 44100 })
        },
        {
            code: 'interfaceCalibrationSweepRangeMismatch',
            source: calibrationSource({ sweepMinFreq: 100 }),
            impulse
        }
    ];

    for (const scenario of cases) {
        dataStorage.getMeasurementById = () => scenario.source;
        dataStorage.getImpulseResponse = async () => scenario.impulse;
        const controller = new MeasurementController();
        let preparationCalls = 0;
        controller.prepareForLevelAdjustment = async () => { preparationCalls += 1; };
        await assert.rejects(
            controller.startNewMeasurement(measurementConfig(selection)),
            error => error instanceof MeasurementSetupError && error.code === scenario.code
        );
        assert.equal(preparationCalls, 0);
        assert.equal(controller.currentMeasurement, null);
        assert.equal(controller.measurementConfig, null);
        assert.equal(controller.interfaceCalibrationImpulseResponse, null);
        assert.equal(controller.startMeasurementPromise, null);
    }
});

test('level preparation failure cleans up, restores state, and releases start guard', async t => {
    const source = calibrationSource();
    const impulse = calibrationImpulse();
    installMeasurementStartEnvironment(t, source, impulse);
    const controller = new MeasurementController();
    const previousConfig = { name: 'Previous config' };
    const previousMeasurement = { id: 'measurement-previous' };
    const previousCalibration = { data: Float32Array.from([1]) };
    const previousCalibrationMap = new Map([['left', previousCalibration]]);
    controller.measurementConfig = previousConfig;
    controller.currentMeasurement = previousMeasurement;
    controller.interfaceCalibrationImpulseResponse = previousCalibration;
    controller.interfaceCalibrationImpulseResponsesByChannel = previousCalibrationMap;
    let attempts = 0;
    let cleanupCalls = 0;
    controller.prepareForLevelAdjustment = async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('Simulated input failure');
    };
    controller.cleanup = () => { cleanupCalls += 1; };
    const config = measurementConfig({
        sourceMeasurementId: source.id,
        sourcePointId: 3
    });

    await assert.rejects(controller.startNewMeasurement(config), /input failure/);
    assert.strictEqual(controller.measurementConfig, previousConfig);
    assert.strictEqual(controller.currentMeasurement, previousMeasurement);
    assert.strictEqual(controller.interfaceCalibrationImpulseResponse, previousCalibration);
    assert.strictEqual(
        controller.interfaceCalibrationImpulseResponsesByChannel,
        previousCalibrationMap
    );
    assert.equal(controller.startMeasurementPromise, null);
    assert.equal(cleanupCalls, 1);

    const measurement = await controller.startNewMeasurement(config);
    assert.equal(measurement.id, 'measurement-new');
    assert.equal(attempts, 2);
});

test('level adjustment preparation stops partial input and propagates failure', async t => {
    const originals = {
        audioContext: audioUtils.audioContext,
        startMicrophoneInput: audioUtils.startMicrophoneInput,
        stopMicrophoneInput: audioUtils.stopMicrophoneInput
    };
    t.after(() => {
        audioUtils.audioContext = originals.audioContext;
        audioUtils.startMicrophoneInput = originals.startMicrophoneInput;
        audioUtils.stopMicrophoneInput = originals.stopMicrophoneInput;
    });
    audioUtils.audioContext = { state: 'running' };
    let stopCalls = 0;
    audioUtils.startMicrophoneInput = async () => {
        throw new Error('Simulated device rejection');
    };
    audioUtils.stopMicrophoneInput = () => { stopCalls += 1; };
    const controller = {
        ...LevelAdjustment,
        measurementConfig: { audioInputId: 'input', inputChannel: 'left' },
        stopLevelMeter() {}
    };

    await assert.rejects(
        controller.prepareForLevelAdjustment(),
        /device rejection/
    );
    assert.equal(stopCalls, 1);
});

test('calibrated deconvolution failures reject instead of exposing uncalibrated fallback', () => {
    const originalInverseFilter = audioUtils.lastInverseFilter;
    audioUtils.lastInverseFilter = null;
    try {
        assert.throws(() => AudioProcessing.processRecordedBuffer.call({
            ...AudioProcessing,
            interfaceCalibrationImpulseResponse: calibrationImpulse(),
            currentMeasurement: { sweepMinFreq: 20, sweepMaxFreq: 20000 }
        }, new Float32Array(32), 8, 1, 48000), /could not be created/);
    } finally {
        audioUtils.lastInverseFilter = originalInverseFilter;
    }
});

test('configuration lists uncalibrated mono and imported multichannel IR candidates', async t => {
    const originals = {
        measurements: dataStorage.measurements,
        irPersistenceAvailable: dataStorage.irPersistenceAvailable,
        document: globalThis.document
    };
    t.after(() => {
        dataStorage.measurements = originals.measurements;
        dataStorage.irPersistenceAvailable = originals.irPersistenceAvailable;
        globalThis.document = originals.document;
    });

    class FakeElement {
        constructor() {
            this.children = [];
            this.disabled = false;
            this.textContent = '';
            this.value = '';
        }
        replaceChildren(...children) { this.children = children; }
        appendChild(child) { this.children.push(child); }
        focus() {}
    }

    const elements = new Map([
        ['measurementName', new FakeElement()],
        ['interfaceCalibration', new FakeElement()],
        ['interfaceCalibrationHelp', new FakeElement()]
    ]);
    globalThis.document = {
        getElementById: id => elements.get(id),
        createElement: () => new FakeElement()
    };
    dataStorage.irPersistenceAvailable = true;
    const imported = createImpulseResponseMeasurement({
        id: 'measurement-imported-stereo',
        name: 'Imported loopback',
        channels: [Float32Array.of(1, 0), Float32Array.of(0.5, 1)],
        sampleRate: 48000,
        timestamp: '2026-08-27T00:00:00.000Z'
    });
    dataStorage.measurements = [
        calibrationSource(),
        imported.measurement,
        calibrationSource({
            id: 'measurement-corrected',
            interfaceCalibration: {
                sourceMeasurementId: 'older',
                sourcePointId: 0
            }
        }),
        calibrationSource({
            id: 'measurement-no-ir',
            points: [{
                pointId: 4,
                name: 'No IR',
                frequencyResponse: [[100, 0]]
            }]
        })
    ];
    const manager = new UIManager();
    manager.showScreen = () => {};

    manager.prepareConfigScreen();
    const select = elements.get('interfaceCalibration');
    assert.equal(select.disabled, false);
    assert.equal(select.children.length, 4);
    assert.equal(select.children[0].value, '');
    assert.deepEqual(JSON.parse(select.children[1].value), [
        'measurement-calibration',
        3
    ]);
    assert.match(select.children[1].textContent, /Interface loopback/);
    assert.deepEqual(JSON.parse(select.children[2].value), [
        'measurement-imported-stereo',
        0,
        'left'
    ]);
    assert.deepEqual(JSON.parse(select.children[3].value), [
        'measurement-imported-stereo',
        0,
        'right'
    ]);

    dataStorage.irPersistenceAvailable = false;
    manager.prepareConfigScreen();
    assert.equal(select.disabled, true);
    assert.equal(select.children.length, 1);
    assert.match(elements.get('interfaceCalibrationHelp').textContent, /unavailable/i);
});

test('configuration busy state restores each control to its original disabled state', () => {
    const manager = new UIManager();
    const name = { disabled: false };
    const outputDevice = { disabled: false };
    const unavailableCalibration = { disabled: true };
    const form = {
        elements: [name, outputDevice, unavailableCalibration]
    };

    manager.setConfigFormBusy(form, true);
    assert.equal(name.disabled, true);
    assert.equal(outputDevice.disabled, true);
    assert.equal(unavailableCalibration.disabled, true);

    manager.setConfigFormBusy(form, false);
    assert.equal(name.disabled, false);
    assert.equal(outputDevice.disabled, false);
    assert.equal(unavailableCalibration.disabled, true);
    assert.equal(manager.configControlDisabledStates.size, 0);
});

test('navigation cleanup selects exactly one controller cleanup owner', t => {
    const originals = {
        isRunningMeasurement: measurementController.isRunningMeasurement,
        cancelMeasurement: measurementController.cancelMeasurement,
        cleanup: measurementController.cleanup,
        document: globalThis.document
    };
    t.after(() => {
        measurementController.isRunningMeasurement = originals.isRunningMeasurement;
        measurementController.cancelMeasurement = originals.cancelMeasurement;
        measurementController.cleanup = originals.cleanup;
        globalThis.document = originals.document;
    });

    const noiseToggleButton = { textContent: 'Stop test signal' };
    globalThis.document = {
        getElementById: id => id === 'noiseToggleBtn' ? noiseToggleButton : null
    };
    let cancelCalls = 0;
    let cleanupCalls = 0;
    measurementController.cancelMeasurement = () => { cancelCalls += 1; };
    measurementController.cleanup = () => { cleanupCalls += 1; };
    const manager = new UIManager();

    measurementController.isRunningMeasurement = true;
    manager.cleanupAudioBeforeNavigation();
    assert.equal(cancelCalls, 1);
    assert.equal(cleanupCalls, 0);
    assert.match(noiseToggleButton.textContent, /test signal/i);

    measurementController.isRunningMeasurement = false;
    manager.cleanupAudioBeforeNavigation();
    assert.equal(cancelCalls, 1);
    assert.equal(cleanupCalls, 1);
});

test('measurement cancellation performs each concrete audio stop once', t => {
    const originals = {
        audioContext: audioUtils.audioContext,
        stopWhiteNoise: audioUtils.stopWhiteNoise,
        stopMicrophoneInput: audioUtils.stopMicrophoneInput
    };
    t.after(() => {
        audioUtils.audioContext = originals.audioContext;
        audioUtils.stopWhiteNoise = originals.stopWhiteNoise;
        audioUtils.stopMicrophoneInput = originals.stopMicrophoneInput;
    });

    const calls = { cleanup: 0, sweep: 0, level: 0, noise: 0, microphone: 0 };
    audioUtils.audioContext = null;
    audioUtils.stopWhiteNoise = () => { calls.noise += 1; };
    audioUtils.stopMicrophoneInput = () => { calls.microphone += 1; };
    const controller = new MeasurementController();
    controller.isRunningMeasurement = true;
    controller.stopSweepPlayback = () => { calls.sweep += 1; };
    controller.stopLevelMeter = () => { calls.level += 1; };
    const cleanup = controller.cleanup.bind(controller);
    controller.cleanup = () => {
        calls.cleanup += 1;
        cleanup();
    };

    controller.cancelMeasurement();

    assert.deepEqual(calls, {
        cleanup: 1,
        sweep: 1,
        level: 1,
        noise: 1,
        microphone: 1
    });
    assert.equal(controller.isRunningMeasurement, false);
});

test('back, select, start-new, and save-finish transitions have one cleanup boundary', async t => {
    const originals = {
        window: globalThis.window,
        document: globalThis.document
    };
    t.after(() => {
        globalThis.window = originals.window;
        globalThis.document = originals.document;
    });
    globalThis.document = {
        getElementById: () => null,
        querySelectorAll: () => [],
        querySelector: () => null,
        body: { classList: { contains: () => false } }
    };
    globalThis.window = { app: {
        initializeAudio: async () => {},
        populateAudioDevices: async () => {},
        selectSavedAudioDevices: () => {}
    } };

    const manager = new UIManager();
    let cleanupCalls = 0;
    manager.cleanupAudioBeforeNavigation = () => { cleanupCalls += 1; };

    manager.currentScreen = 'levelAdjustmentScreen';
    manager.showScreen('measurementConfigScreen');
    assert.equal(cleanupCalls, 1, 'Back cleans up once');

    manager.currentScreen = 'sweepMeasurementScreen';
    manager.measurementDisplay.updateSelectedMeasurementHighlight = () => {};
    manager.measurementDisplay.displayMeasurementDetails = () => {};
    manager.correctionHandler.requestCorrectionUpdate = () => {};
    await manager.selectMeasurement('measurement-selected');
    assert.equal(cleanupCalls, 2, 'Select cleans up once');

    manager.currentScreen = 'resultsDisplayScreen';
    manager.prepareConfigScreen = () => manager.showScreen('measurementConfigScreen');
    await manager.startNewMeasurement();
    assert.equal(cleanupCalls, 2, 'Start New does not clean inactive audio');

    manager.currentScreen = 'sweepMeasurementScreen';
    const finishingController = {
        ...SweepMeasurement,
        saveAndFinishMeasurement: async () => 'measurement-finished',
        cleanup: () => assert.fail('finishMeasurement must not own navigation cleanup')
    };
    assert.equal(await finishingController.finishMeasurement(), 'measurement-finished');
    manager.showScreen('resultsDisplayScreen');
    assert.equal(cleanupCalls, 3, 'Save and Finish cleans up once via showScreen');

    manager.currentScreen = 'sweepMeasurementScreen';
    const failingController = {
        ...SweepMeasurement,
        saveAndFinishMeasurement: async () => { throw new Error('save failed'); },
        cleanup: () => assert.fail('failed finish must keep the active screen and audio state')
    };
    await assert.rejects(failingController.finishMeasurement(), /save failed/);
    assert.equal(manager.currentScreen, 'sweepMeasurementScreen');
    assert.equal(cleanupCalls, 3);
});

test('New Measurement restores automatic noise and common calibration modes', async t => {
    const originals = {
        window: globalThis.window,
        document: globalThis.document,
        stopChannelRotation: measurementController.stopChannelRotation
    };
    t.after(() => {
        globalThis.window = originals.window;
        globalThis.document = originals.document;
        measurementController.stopChannelRotation = originals.stopChannelRotation;
    });
    const noiseMode = radioGroup('manual');
    const calibrationMode = { value: 'perChannel' };
    const commonCalibration = { hidden: true };
    const perChannelRows = {
        hidden: false,
        childCount: 2,
        replaceChildren() {
            this.childCount = 0;
            events.push('clear-calibration-rows');
        }
    };
    const elements = {
        noiseChannelMode: noiseMode,
        calibrationAssignMode: calibrationMode,
        interfaceCalibration: commonCalibration,
        perChannelCalibrationRows: perChannelRows
    };
    globalThis.document = {
        getElementById: id => elements[id] || null
    };
    const events = [];
    measurementController.stopChannelRotation = () => events.push('stop-rotation');
    globalThis.window = { app: {
        initializeAudio: async () => { events.push('initialize-audio'); },
        populateAudioDevices: async () => { events.push('populate-devices'); },
        selectSavedAudioDevices: () => { events.push('select-devices'); }
    } };
    const manager = new UIManager();
    manager.prepareConfigScreen = () => {
        assert.equal(calibrationMode.value, 'common');
        assert.equal(perChannelRows.childCount, 0);
        assert.equal(perChannelRows.hidden, true);
        assert.equal(commonCalibration.hidden, false);
        events.push('prepare-config');
    };

    await manager.startNewMeasurement();

    assert.equal(noiseMode.querySelector().value, 'auto');
    assert.equal(calibrationMode.value, 'common');
    assert.deepEqual(events, [
        'clear-calibration-rows',
        'stop-rotation',
        'initialize-audio',
        'populate-devices',
        'prepare-config',
        'select-devices'
    ]);
});

test('empty channel responses follow the existing unavailable PEQ path', async t => {
    const originals = {
        document: globalThis.document,
        window: globalThis.window,
        getMeasurementById: dataStorage.getMeasurementById
    };
    t.after(() => {
        globalThis.document = originals.document;
        globalThis.window = originals.window;
        dataStorage.getMeasurementById = originals.getMeasurementById;
    });
    const measurement = {
        id: 'empty-channel-response',
        outputChannel: 'multi',
        outputChannels: ['left', '2'],
        points: [],
        channelResponses: [
            { channel: 'left', averageFrequencyResponse: [[100, -1]] },
            { channel: '2', averageFrequencyResponse: [[100, -2]] }
        ]
    };
    dataStorage.getMeasurementById = () => measurement;
    let peqControlReads = 0;
    globalThis.document = {
        getElementById: id => {
            peqControlReads += 1;
            return id === 'eqBandCount' ? { value: '3' } : null;
        }
    };
    let clipboardWrites = 0;
    globalThis.window = { electronAPI: {
        writeClipboardText: async () => {
            clipboardWrites += 1;
            return true;
        }
    } };
    const manager = new UIManager();
    manager.selectedMeasurementId = measurement.id;
    let effectCalculations = 0;
    manager.correctionHandler.getTargetSettings = () => {
        effectCalculations += 1;
        return {};
    };
    manager.correctionHandler.calculatePEQParametersForResponse = async () => {
        effectCalculations += 1;
        return [];
    };
    const notifications = [];
    manager.showNotification = (...args) => notifications.push(args);

    assert.equal(await manager.copyChannelPEQToClipboard(), false);
    assert.equal(effectCalculations, 0);
    assert.equal(peqControlReads, 0);
    assert.equal(clipboardWrites, 0);
    assert.equal(notifications.length, 1);
    assert.match(notifications[0][0], /No PEQ settings available/i);
    assert.equal(notifications[0][1], 'error');

    measurement.points.push({ pointId: 0 });
    measurement.channelResponses = [
        { channel: 'left', averageFrequencyResponse: [[100, -1]] },
        { channel: '2', averageFrequencyResponse: [] }
    ];
    notifications.length = 0;

    assert.equal(await manager.copyChannelPEQToClipboard(), false);
    assert.equal(effectCalculations, 0);
    assert.equal(peqControlReads, 0);
    assert.equal(clipboardWrites, 0);
    assert.equal(notifications.length, 1);
    assert.match(notifications[0][0], /No PEQ settings available/i);
    assert.equal(notifications[0][1], 'error');

    measurement.channelResponses[1].averageFrequencyResponse = [[100, -2]];
    manager.correctionHandler.getTargetSettings = () => ({ smoothing: 0.5 });
    const solvedChannels = [];
    manager.correctionHandler.calculatePEQParametersForResponse = async (response, settings, source, channel) => {
        assert.strictEqual(source, measurement);
        assert.strictEqual(response, measurement.channelResponses.find(entry => entry.channel === channel).averageFrequencyResponse);
        solvedChannels.push(channel);
        return [{ frequency: 100, gain: -1, Q: 1 }];
    };
    notifications.length = 0;

    assert.equal(await manager.copyChannelPEQToClipboard(), true);
    assert.deepEqual(solvedChannels, ['left', '2']);
    assert.equal(peqControlReads, 1);
    assert.equal(clipboardWrites, 1);
    assert.equal(notifications.length, 1);
    assert.match(notifications[0][0], /copied/i);
    assert.equal(notifications[0][1], undefined);
});

test('next-point level preparation failure preserves the current point and sweep screen', async t => {
    const originalShowScreen = uiManager.showScreen;
    const originalShowNotification = uiManager.showNotification;
    t.after(() => {
        uiManager.showScreen = originalShowScreen;
        uiManager.showNotification = originalShowNotification;
    });
    let shownScreen = null;
    let notice = null;
    uiManager.showScreen = screen => { shownScreen = screen; };
    uiManager.showNotification = message => { notice = message; };
    const currentPoint = point(2, 4);
    const currentImpulseResponse = calibrationImpulse();
    const controller = {
        ...SweepMeasurement,
        currentSweepIndex: 5,
        sweepMeasurements: [{ result: true }],
        currentPoint,
        currentImpulseResponse,
        prepareForLevelAdjustment: async () => {
            throw new Error('Simulated retry failure');
        }
    };

    assert.equal(await controller.resetForNextMeasurement(), false);
    assert.equal(controller.currentSweepIndex, 5);
    assert.equal(controller.sweepMeasurements.length, 1);
    assert.strictEqual(controller.currentPoint, currentPoint);
    assert.strictEqual(controller.currentImpulseResponse, currentImpulseResponse);
    assert.equal(shownScreen, 'sweepMeasurementScreen');
    assert.match(notice, /could not be prepared/i);
});

test('only valid deconvolution publishes IR metadata and binary for atomic saving', async t => {
    await withPatchedSingletons(t, async () => {
        const originalInverseFilter = audioUtils.lastInverseFilter;
        t.after(() => {
            audioUtils.lastInverseFilter = originalInverseFilter;
        });
        const sweepLength = 5000;
        const sampleRate = 100;
        const capturePlan = createSweepCapturePlan(sweepLength, 1, sampleRate);
        const preRollSamples = sampleRate / 2;
        const recording = new Float32Array(
            preRollSamples + capturePlan.analysisStartSamples + sweepLength
        );
        recording[preRollSamples + capturePlan.analysisStartSamples + 4096] = 1;
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
            points: [point(0, 1), {
                ...point(1, 3), frequencyResponse: [[100, 3], [200, 4], [300, 5], [400, 4], [500, 3]]
            }],
            averageFrequencyResponse: [[100, 2], [1000, 3]],
            maxSignalLevel: -19.5,
            correctionLowFreq: 30,
            correctionHighFreq: 18000,
            smoothing: 0.25,
            eqBandCount: 3,
            peqParameters: [{ frequency: 100, gain: -2, Q: 1 }]
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
            smoothFrequencyResponse: response => response
        } } };

        const manager = new UIManager();
        manager.selectedMeasurementId = measurement.id;
        manager.updateResultsGraph = () => {};
        manager.graphRenderer.normalizeResponseToZeroDb = response => response;
        manager.measurementDisplay.displayMeasurementDetails = () => {};
        manager.correctionHandler.updateFrequencyMarkers = () => {};
        manager.correctionHandler.peqCalculator.calculatePEQParameters = () => {
            calculationStarted = true;
            return pendingCalculation;
        };
        manager.correctionHandler.requestCorrectionUpdate = generation =>
            manager.correctionHandler.updateCorrection(generation);

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
                peqParameters: [{ frequency: 100, gain: -2, Q: 1 }]
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
