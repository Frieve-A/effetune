import assert from 'node:assert/strict';
import test from 'node:test';

import {
    normalizePipelineAnalyzerState,
    PipelineAnalyzerController
} from '../../js/pipeline-analyzer/controller.js';
import { PipelineSnapshotError } from '../../js/pipeline-analyzer/pipeline-snapshot.js';

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((onResolve, onReject) => {
        resolve = onResolve;
        reject = onReject;
    });
    return { promise, resolve, reject };
}

function nextTask() {
    return new Promise(resolve => setTimeout(resolve, 0));
}

class FakeAudioManager {
    constructor(channelCount = 2) {
        this.currentPipeline = 'A';
        this.masterBypass = false;
        this.pipeline = [];
        this.contextManager = {
            audioContext: {
                sampleRate: 48000,
                destination: { channelCount }
            }
        };
        this.listeners = new Map();
    }

    getCurrentPipeline() {
        return this.pipeline;
    }

    addEventListener(name, callback) {
        let listeners = this.listeners.get(name);
        if (!listeners) {
            listeners = new Set();
            this.listeners.set(name, listeners);
        }
        listeners.add(callback);
    }

    removeEventListener(name, callback) {
        this.listeners.get(name)?.delete(callback);
    }

    dispatchEvent(name, detail) {
        for (const callback of this.listeners.get(name) || []) callback(detail);
    }

    getEnabledDspTypes() {
        return [];
    }
}

class FakeUi {
    constructor() {
        this.results = [];
        this.measurementAvailability = [];
        this.measurements = [];
        this.measuringStates = [];
    }

    setOpen(value) { this.open = value; }
    setConfiguration(value) { this.configuration = value; }
    setAudioFormat(value) { this.audioFormat = value; }
    setMeasurementStoreAvailable(value) { this.measurementAvailability.push(value); }
    setMeasurements(value) { this.measurements.push(value); }
    setMeasuring(value) { this.measuringStates.push(value); }
    setResult(value, options = {}) {
        this.results.push(value);
        this.resultOptions = options;
    }
    dispose() { this.disposed = true; }
}

class FakeWorker {
    constructor(autoResult = false) {
        this.autoResult = autoResult;
        this.requests = [];
        this.terminated = 0;
        this.onmessage = null;
        this.onerror = null;
    }

    postMessage(request) {
        this.requests.push(request);
        if (!this.autoResult) return;
        const spectrum = {
            frequencies: new Float32Array([20, 1000]),
            magnitudeDb: new Float32Array([0, 0]),
            phaseDegrees: new Float32Array([0, 0]),
            groupDelayMs: new Float32Array([0, 0]),
            minimumGroupDelayMs: new Float32Array([0, 0]),
            excessGroupDelayMs: new Float32Array([0, 0]),
            valid: new Uint8Array([1, 1])
        };
        const impulse = new Float32Array([1]);
        queueMicrotask(() => this.onmessage?.({
            data: {
                type: 'result',
                activationEpoch: request.activationEpoch,
                runGeneration: request.runGeneration,
                result: {
                    sampleRate: request.snapshot.sampleRate,
                    reportedLatency: 0,
                    captureLength: 128,
                    truncated: false,
                    measurement: {
                        signalType: 'mls',
                        stabilizationSeconds: 16.384,
                        totalStimulusSeconds: 19.114
                    },
                    before: { impulse, spectrum, timeOriginSamples: 0 },
                    after: { impulse, spectrum, timeOriginSamples: 0 }
                }
            }
        }));
    }

    terminate() {
        this.terminated += 1;
    }
}

function builtSnapshot() {
    return {
        snapshot: {
            sampleRate: 48000,
            channelCount: 2,
            inputChannel: 0,
            outputChannels: [0],
            plugins: [],
            masterBypass: false,
            processors: [],
            dsp: null,
            assets: []
        },
        speakerResponses: [null],
        provenance: {
            pipelineIdentity: 'A',
            outputs: [{
                channel: 0,
                measurementLabel: 'Living Room',
                pointLabel: 'Listening Seat'
            }],
            measurementSettings: {
                signalType: 'mls',
                levelDb: -12,
                sequenceLength: 65535,
                stabilizationPeriods: 12,
                averagingPeriods: 2
            }
        }
    };
}

test('state migration keeps participating legacy outputs and applies MLS defaults', () => {
    const state = normalizePipelineAnalyzerState({
        open: true,
        view: 'phase',
        inputChannel: 4,
        slots: [{
            enabled: true,
            channel: 6,
            measurementId: 'measurement',
            pointId: 'point'
        }, {
            enabled: false,
            channel: 7,
            measurementId: 'unused',
            pointId: 'unused'
        }]
    });
    assert.equal(state.open, true);
    assert.equal(state.graphView, 'phase');
    assert.equal(state.autoRefresh, true);
    assert.equal(state.inputChannel, 4);
    assert.deepEqual(state.outputs, [{
        channel: 6,
        measurementId: 'measurement',
        pointId: 'point'
    }]);
    assert.deepEqual(state.measurementSettings, {
        signalType: 'mls',
        levelDb: -12,
        sequenceLength: 65535,
        stabilizationPeriods: 12,
        averagingPeriods: 2
    });
    assert.deepEqual(state.displaySettings, { smoothingOct: 0.17, impulseRangeMs: 6 });
});

test('state preserves an explicit Auto-off selection', () => {
    assert.equal(normalizePipelineAnalyzerState({ autoRefresh: false }).autoRefresh, false);
});

test('state migrates the legacy Group Delay view to Min Group Delay', () => {
    assert.equal(
        normalizePipelineAnalyzerState({ graphView: 'groupDelay' }).graphView,
        'minimumGroupDelay'
    );
});

test('display settings are bounded independently from measurement settings', () => {
    const state = normalizePipelineAnalyzerState({
        displaySettings: { smoothingOct: 4, impulseRangeMs: 0.25 }
    });
    assert.deepEqual(state.displaySettings, { smoothingOct: 1, impulseRangeMs: 1 });
    assert.equal(state.measurementSettings.sequenceLength, 65535);
});

test('display-only edits debounce presentation work and commits flush without creating a Worker', () => {
    const ui = new FakeUi();
    const timers = new Map();
    const clearedTimers = [];
    const savedStates = [];
    const adapterCalls = [];
    let nextTimer = 1;
    let workerCount = 0;
    const controller = new PipelineAnalyzerController({
        audioManager: new FakeAudioManager(),
        workletSync: { preparePluginData: () => ({}) },
        ui,
        storage: {
            getItem: () => null,
            setItem: (_key, value) => savedStates.push(JSON.parse(value))
        },
        createWorker: () => {
            workerCount += 1;
            return new FakeWorker();
        },
        setDisplayReadaptTimeout: (callback, delay) => {
            const id = nextTimer;
            nextTimer += 1;
            timers.set(id, { callback, delay });
            return id;
        },
        clearDisplayReadaptTimeout: id => {
            clearedTimers.push(id);
            timers.delete(id);
        },
        resultAdapter: (raw, provenance) => {
            adapterCalls.push({ raw, provenance });
            return {
                ...raw,
                displaySettings: Object.freeze({ ...provenance.displaySettings }),
                views: {}
            };
        }
    });
    controller.lastAcceptedRawResult = {
        sampleRate: 48000,
        before: { impulse: new Float32Array([1]), spectrum: {}, timeOriginSamples: 0 },
        after: { impulse: new Float32Array([1]), spectrum: {}, timeOriginSamples: 0 }
    };
    controller.lastAcceptedMetadata = { runGeneration: 7 };
    controller.lastAcceptedProvenance = {};
    controller.runGeneration = 9;
    controller.lastAcceptedStale = true;

    controller.setConfiguration({ displaySettings: { smoothingOct: 0.2, impulseRangeMs: 6 } }, {
        displayCommit: false
    });
    assert.deepEqual(savedStates.at(-1).displaySettings, { smoothingOct: 0.2, impulseRangeMs: 6 });
    assert.equal(timers.size, 1);
    assert.equal([...timers.values()][0].delay, 150);
    assert.equal(adapterCalls.length, 0);
    const firstTimer = [...timers.keys()][0];

    controller.setConfiguration({ displaySettings: { smoothingOct: 0.3, impulseRangeMs: 6 } }, {
        displayCommit: false
    });
    assert.equal(clearedTimers.includes(firstTimer), true);
    assert.equal(timers.size, 1);
    const secondTimer = [...timers.keys()][0];
    const scheduled = timers.get(secondTimer);
    timers.delete(secondTimer);
    scheduled.callback();
    assert.equal(adapterCalls.length, 1);
    assert.equal(adapterCalls[0].provenance.displaySettings.smoothingOct, 0.3);

    controller.setConfiguration({ displaySettings: { smoothingOct: 0.4, impulseRangeMs: 6 } }, {
        displayCommit: false
    });
    const pendingCommitTimer = [...timers.keys()][0];
    controller.setConfiguration({ displaySettings: { smoothingOct: 0.4, impulseRangeMs: 6 } }, {
        displayCommit: true
    });
    assert.equal(clearedTimers.includes(pendingCommitTimer), true);
    assert.equal(timers.size, 0);
    assert.equal(adapterCalls.length, 2);
    assert.equal(workerCount, 0);
    assert.equal(controller.runGeneration, 9);
    assert.equal(controller.lastAcceptedStale, true);

    controller.setConfiguration({ displaySettings: { smoothingOct: 0.5, impulseRangeMs: 6 } }, {
        displayCommit: false
    });
    controller._boundPageHide();
    assert.equal(timers.size, 0);
    assert.equal(adapterCalls.length, 2);

    controller.setConfiguration({ displaySettings: { smoothingOct: 0.6, impulseRangeMs: 6 } }, {
        displayCommit: false
    });
    assert.equal(timers.size, 1);
    controller.dispose();
    assert.equal(timers.size, 0);
    assert.equal(workerCount, 0);
});

test('a Store opened after close is closed locally and cannot attach to a reopened activation', async () => {
    const firstOpen = deferred();
    const secondOpen = deferred();
    let openCount = 0;
    const oldStore = {
        closeCount: 0,
        close() { this.closeCount += 1; },
        listMeasurements: () => []
    };
    const currentStore = {
        closeCount: 0,
        close() { this.closeCount += 1; },
        listMeasurements: () => []
    };
    const controller = new PipelineAnalyzerController({
        audioManager: new FakeAudioManager(),
        workletSync: { preparePluginData: () => ({}) },
        ui: new FakeUi(),
        storage: null,
        openMeasurementStore: () => (++openCount === 1 ? firstOpen.promise : secondOpen.promise),
        snapshotBuilder: async () => builtSnapshot(),
        createWorker: () => new FakeWorker(),
        debounceMs: 0
    });

    controller.setOpen(true);
    controller.setOpen(false);
    controller.setOpen(true);
    secondOpen.resolve(currentStore);
    await nextTask();
    assert.equal(controller.measurementStore, currentStore);
    firstOpen.resolve(oldStore);
    await nextTask();
    assert.equal(oldStore.closeCount, 1);
    assert.equal(controller.measurementStore, currentStore);
    controller.dispose();
    assert.equal(currentStore.closeCount, 1);
});

test('same-activation stale snapshot continuations cannot create or own the latest Worker', async () => {
    const ui = new FakeUi();
    const workers = [];
    let deferredRuns = null;
    const controller = new PipelineAnalyzerController({
        audioManager: new FakeAudioManager(),
        workletSync: { preparePluginData: () => ({}) },
        ui,
        storage: null,
        openMeasurementStore: async () => null,
        snapshotBuilder: () => {
            if (!deferredRuns) return Promise.resolve(builtSnapshot());
            return deferredRuns.shift().promise;
        },
        createWorker: () => {
            const worker = new FakeWorker();
            workers.push(worker);
            return worker;
        },
        debounceMs: 0
    });
    controller.setOpen(true);
    await nextTask();
    await nextTask();

    const runN = deferred();
    const runN1 = deferred();
    deferredRuns = [runN, runN1];
    const baselineWorkers = workers.length;
    controller.invalidate('run-n', { immediate: true });
    await nextTask();
    controller.invalidate('run-n-plus-one', { immediate: true });
    await nextTask();

    runN.resolve(builtSnapshot());
    await nextTask();
    assert.equal(workers.length, baselineWorkers);
    runN1.resolve(builtSnapshot());
    await nextTask();
    assert.equal(workers.length, baselineWorkers + 1);
    assert.equal(controller.activeWorker, workers.at(-1));
    controller.dispose();
});

test('a Worker made stale inside its factory is terminated without touching the newer run', async () => {
    const workers = [];
    let controller;
    let invalidateInFactory = true;
    controller = new PipelineAnalyzerController({
        audioManager: new FakeAudioManager(),
        workletSync: { preparePluginData: () => ({}) },
        ui: new FakeUi(),
        storage: null,
        openMeasurementStore: async () => null,
        snapshotBuilder: async () => builtSnapshot(),
        createWorker: () => {
            const worker = new FakeWorker();
            workers.push(worker);
            if (invalidateInFactory) {
                invalidateInFactory = false;
                controller.invalidate('factory-race', { immediate: true });
            }
            return worker;
        },
        debounceMs: 0
    });
    controller.setOpen(true);
    await nextTask();
    await nextTask();
    await nextTask();
    assert.equal(workers[0].terminated, 1);
    assert.equal(controller.activeWorker, workers.at(-1));
    controller.dispose();
});

test('identity-only analysis remains Ready without a Store and retained IR resolves later by ID', async () => {
    const ui = new FakeUi();
    let openCount = 0;
    const store = {
        close() {},
        listMeasurements: () => [{ id: 'measurement', name: 'Woofer' }],
        async getMeasurement() {
            return { points: [{ pointId: 'point', label: 'Near field', ir: { stored: true } }] };
        },
        async getImpulseResponse(measurementId, pointId) {
            assert.equal(measurementId, 'measurement');
            assert.equal(pointId, 'point');
            return {
                data: new Float32Array([0, 1, 0]),
                sampleRate: 48000,
                onsetIndex: 1,
                refScale: 1
            };
        },
        async refresh() {}
    };
    const workers = [];
    const controller = new PipelineAnalyzerController({
        audioManager: new FakeAudioManager(),
        workletSync: { preparePluginData: () => ({}) },
        ui,
        storage: null,
        openMeasurementStore: async () => (++openCount === 1 ? null : store),
        resolveRequirements: () => ({ requiresWasm: false, requiredAssetSlots: [], warmupSamples: 0 }),
        createWorker: () => {
            const worker = new FakeWorker(true);
            workers.push(worker);
            return worker;
        },
        debounceMs: 0
    });

    controller.setOpen(true);
    await nextTask();
    await nextTask();
    assert.equal(ui.measurementAvailability.at(-1), false);

    controller.setConfiguration({
        inputChannel: 0,
        outputs: [{
            channel: 0,
            measurementId: 'measurement',
            pointId: 'point'
        }]
    });
    await nextTask();
    await nextTask();
    const workerCountBeforeReopen = workers.length;

    controller.setOpen(false);
    controller.setOpen(true);
    await nextTask();
    await nextTask();
    assert.equal(ui.measurementAvailability.at(-1), true);
    assert.ok(workers.length > workerCountBeforeReopen);
    assert.equal(workers.at(-1).requests[0].speakerResponses[0].pointId, 'point');
    controller.dispose();
});

test('persisted string IDs resolve to the Measurement Store original key types', async () => {
    const store = {
        close() {},
        listMeasurements: () => [{ id: 17, name: 'Tweeter' }],
        async getMeasurement(id) {
            assert.equal(id, 17);
            return { points: [{ pointId: 3, label: 'Axis', ir: { stored: true } }] };
        },
        async getImpulseResponse(measurementId, pointId) {
            assert.equal(measurementId, 17);
            assert.equal(pointId, 3);
            return {
                data: new Float32Array([1]),
                sampleRate: 48000,
                onsetIndex: 0,
                refScale: 1
            };
        },
        async refresh() {}
    };
    const workers = [];
    const controller = new PipelineAnalyzerController({
        audioManager: new FakeAudioManager(),
        workletSync: { preparePluginData: () => ({}) },
        ui: new FakeUi(),
        storage: {
            getItem: () => JSON.stringify({
                open: true,
                slots: [{ enabled: true, channel: 0, measurementId: '17', pointId: '3' }]
            }),
            setItem() {}
        },
        openMeasurementStore: async () => store,
        createWorker: () => {
            const worker = new FakeWorker();
            workers.push(worker);
            return worker;
        },
        debounceMs: 0
    });

    controller.initialize();
    await nextTask();
    await nextTask();
    assert.equal(workers.at(-1).requests[0].speakerResponses[0].pointId, '3');
    controller.dispose();
});

test('accepted results carry normalized views and become stale until the next run', async () => {
    const ui = new FakeUi();
    const workers = [];
    const savedStates = [];
    const controller = new PipelineAnalyzerController({
        audioManager: new FakeAudioManager(),
        workletSync: { preparePluginData: () => ({}) },
        ui,
        storage: {
            getItem: () => null,
            setItem: (_key, value) => savedStates.push(JSON.parse(value))
        },
        openMeasurementStore: async () => null,
        snapshotBuilder: async () => builtSnapshot(),
        createWorker: () => {
            const worker = new FakeWorker(true);
            workers.push(worker);
            return worker;
        },
        debounceMs: 1000
    });

    controller.setOpen(true);
    assert.equal(ui.measuringStates.at(-1), true);
    controller.invalidate('initial', { immediate: true });
    await nextTask();
    await nextTask();
    assert.equal(ui.results.at(-1).pipelineId, 'A');
    assert.equal(ui.results.at(-1).views.frequency.curves.length, 2);
    assert.equal(ui.results.at(-1).views.frequency.curves[0].label, 'Before');
    assert.equal(ui.results.at(-1).views.frequency.curves[1].label, 'After');
    assert.equal(ui.results.at(-1).measurement.stabilizationSeconds, 16.384);
    assert.equal(Object.isFrozen(ui.results.at(-1).measurement), true);
    assert.equal(Object.isFrozen(ui.results.at(-1).measurementSettings), true);
    assert.equal(Object.isFrozen(ui.results.at(-1).displaySettings), true);
    assert.equal(ui.resultOptions.stale, false);

    controller.setConfiguration({ ...ui.configuration, graphView: 'phase' });
    assert.equal(ui.resultOptions.stale, false);

    const workersBeforeDisplayChange = workers.length;
    const acceptedGenerationBeforeDisplayChange = ui.results.at(-1).runGeneration;
    controller.setConfiguration({
        ...ui.configuration,
        displaySettings: { smoothingOct: 0.31, impulseRangeMs: 12.4 }
    });
    assert.equal(workers.length, workersBeforeDisplayChange);
    assert.equal(ui.results.at(-1).runGeneration, acceptedGenerationBeforeDisplayChange);
    assert.deepEqual(ui.results.at(-1).displaySettings, { smoothingOct: 0.31, impulseRangeMs: 12.4 });
    assert.deepEqual(savedStates.at(-1).displaySettings, { smoothingOct: 0.31, impulseRangeMs: 12.4 });
    assert.equal(ui.resultOptions.stale, false);

    assert.equal(ui.results.at(-1).views.frequency.xLabel, 'Frequency (Hz)');
    assert.equal(ui.results.at(-1).views.phase.yLabel, 'Phase (°)');
    assert.equal(ui.results.at(-1).views.frequency.curves[0].label, 'Before');
    assert.equal(ui.results.at(-1).views.frequency.curves.at(-1).label, 'After');

    controller.invalidate('changed');
    assert.equal(ui.resultOptions.stale, true);
    controller.dispose();
});

test('page lifecycle terminates active work and dispose removes host listeners', () => {
    const listeners = new Map();
    const windowRef = {
        addEventListener(name, callback) { listeners.set(name, callback); },
        removeEventListener(name, callback) {
            if (listeners.get(name) === callback) listeners.delete(name);
        }
    };
    const ui = new FakeUi();
    const controller = new PipelineAnalyzerController({
        audioManager: new FakeAudioManager(),
        workletSync: { preparePluginData: () => ({}) },
        ui,
        windowRef,
        storage: {
            getItem: () => JSON.stringify({ open: true }),
            setItem() {}
        },
        openMeasurementStore: async () => null,
        snapshotBuilder: async () => builtSnapshot(),
        createWorker: () => new FakeWorker(),
        debounceMs: 1000
    });

    controller.initialize();
    assert.equal(controller.active, true);
    listeners.get('pagehide')();
    assert.equal(controller.active, false);
    listeners.get('pageshow')();
    assert.equal(controller.active, true);

    controller.dispose();
    assert.equal(listeners.has('pagehide'), false);
    assert.equal(listeners.has('pageshow'), false);
    assert.equal(ui.disposed, true);
});

test('subscription cleanup reports through the injected console and continues', () => {
    const warnings = [];
    const calls = [];
    const controller = new PipelineAnalyzerController({
        audioManager: new FakeAudioManager(),
        workletSync: { preparePluginData: () => ({}) },
        ui: new FakeUi(),
        storage: null,
        consoleRef: {
            warn(...args) { warnings.push(args); }
        }
    });
    const failure = new Error('dispose failed');
    const disposers = [
        () => {
            calls.push('first');
            throw failure;
        },
        () => calls.push('second')
    ];

    controller._clearDisposers(disposers);
    assert.deepEqual(calls, ['first', 'second']);
    assert.equal(disposers.length, 0);
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0][0], '[Pipeline Analyzer] Subscription cleanup failed:');
    assert.equal(warnings[0][1], failure);
    controller.dispose();
});

test('a synchronous postMessage failure releases the exact Worker', async () => {
    const ui = new FakeUi();
    const workers = [];
    class ThrowingWorker extends FakeWorker {
        postMessage() {
            throw new DOMException('Could not clone request', 'DataCloneError');
        }
    }
    const controller = new PipelineAnalyzerController({
        audioManager: new FakeAudioManager(),
        workletSync: { preparePluginData: () => ({}) },
        ui,
        storage: null,
        openMeasurementStore: async () => null,
        snapshotBuilder: async () => builtSnapshot(),
        consoleRef: { error() {} },
        createWorker: () => {
            const worker = new ThrowingWorker();
            workers.push(worker);
            return worker;
        },
        debounceMs: 0
    });

    controller.setOpen(true);
    await nextTask();
    await nextTask();
    assert.ok(workers.length > 0);
    assert.equal(controller.activeWorker, null);
    for (const worker of workers) {
        assert.equal(worker.terminated, 1);
        assert.equal(worker.onmessage, null);
        assert.equal(worker.onerror, null);
    }
    controller.dispose();
});

test('execution failures preserve the accepted result and log developer diagnostics once', () => {
    const ui = new FakeUi();
    const diagnostics = [];
    const controller = new PipelineAnalyzerController({
        audioManager: new FakeAudioManager(),
        workletSync: { preparePluginData: () => ({}) },
        ui,
        storage: null,
        consoleRef: { error: (...args) => diagnostics.push(args) }
    });
    const acceptedResult = Object.freeze({ views: {} });
    controller.lastAcceptedResult = acceptedResult;
    controller.lastAcceptedStale = true;
    ui.setResult(acceptedResult, { stale: true });
    ui.setMeasuring(true);

    controller._reportRunError(new PipelineSnapshotError('non-finite-output'));
    assert.equal(ui.resultOptions.stale, true);
    assert.ok(ui.results.at(-1) === acceptedResult, 'accepted result must remain visible');
    assert.equal(ui.results.length, 1, 'terminal failure must not replace the accepted result');
    assert.equal(ui.measuringStates.at(-1), false);
    assert.equal(controller.lastAcceptedStale, false);
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0][1].code, 'non-finite-output');

    controller.active = true;
    controller.invalidate('retry', { immediate: true });
    assert.equal(ui.measuringStates.at(-1), true, 'a new invalidation must restore busy state');
    controller._clearDebounce();
    controller._reportRunError(new PipelineSnapshotError('speaker-ir-missing'));
    assert.equal(ui.measuringStates.at(-1), false);
    assert.equal(diagnostics.length, 2);
    assert.equal(diagnostics[1][1].code, 'speaker-ir-missing');
    controller.dispose();
});

test('audio format reconciliation removes unavailable outputs without dormant restoration', () => {
    const audioManager = new FakeAudioManager(8);
    const ui = new FakeUi();
    const controller = new PipelineAnalyzerController({
        audioManager,
        workletSync: { preparePluginData: () => ({}) },
        ui,
        storage: null,
        openMeasurementStore: async () => null
    });
    controller.setConfiguration({
        inputChannel: 0,
        outputs: [
            { channel: 1, measurementId: null, pointId: null },
            { channel: 3, measurementId: null, pointId: null },
            { channel: 5, measurementId: 'mid', pointId: 'near' },
            { channel: 7, measurementId: 'high', pointId: 'near' }
        ]
    });
    controller.initialize();
    assert.deepEqual(controller.state.outputs.map(output => output.channel), [1, 3, 5, 7]);
    audioManager.contextManager.audioContext.destination.channelCount = 2;
    controller.refreshAudioFormat();
    assert.deepEqual(controller.state.outputs.map(output => output.channel), [1]);
    audioManager.contextManager.audioContext.destination.channelCount = 8;
    controller.refreshAudioFormat();
    assert.deepEqual(controller.state.outputs.map(output => output.channel), [1]);
    assert.deepEqual(ui.audioFormat, { sampleRate: 48000, channelCount: 8 });
    controller.dispose();
});

test('pending audio format is non-destructive and valid format changes publish synchronously', () => {
    const audioManager = new FakeAudioManager(4);
    const ui = new FakeUi();
    const controller = new PipelineAnalyzerController({
        audioManager,
        workletSync: { preparePluginData: () => ({}) },
        ui,
        storage: null
    });
    controller.setConfiguration({
        outputs: [
            { channel: 0 },
            { channel: 2 }
        ]
    });
    controller.initialize();
    assert.deepEqual(ui.audioFormat, { sampleRate: 48000, channelCount: 4 });
    audioManager.contextManager.audioContext = null;
    controller.refreshAudioFormat();
    assert.equal(ui.audioFormat, null);
    assert.deepEqual(controller.state.outputs.map(output => output.channel), [0, 2]);
    audioManager.contextManager.audioContext = {
        sampleRate: 96000,
        destination: { channelCount: 4 }
    };
    controller.refreshAudioFormat();
    assert.deepEqual(ui.audioFormat, { sampleRate: 96000, channelCount: 4 });
    assert.deepEqual(controller.state.outputs.map(output => output.channel), [0, 2]);
    controller.dispose();
});

test('saved-open startup waits for restored audio before creating exactly one Worker', async () => {
    const audioManager = new FakeAudioManager(2);
    audioManager.contextManager.audioContext = null;
    const ui = new FakeUi();
    const workers = [];
    let snapshotCount = 0;
    const controller = new PipelineAnalyzerController({
        audioManager,
        workletSync: { preparePluginData: () => ({}) },
        ui,
        storage: {
            getItem: () => JSON.stringify({ open: true }),
            setItem() {}
        },
        openMeasurementStore: async () => null,
        snapshotBuilder: async () => {
            snapshotCount += 1;
            return builtSnapshot();
        },
        createWorker: () => {
            const worker = new FakeWorker();
            workers.push(worker);
            return worker;
        },
        debounceMs: 0
    });

    controller.initialize();
    await nextTask();
    await nextTask();
    assert.equal(ui.audioFormat, null);
    assert.equal(snapshotCount, 0);
    assert.equal(workers.length, 0);

    audioManager.contextManager.audioContext = {
        sampleRate: 48000,
        destination: { channelCount: 2 }
    };
    controller.refreshAudioFormat();
    await nextTask();
    assert.deepEqual(ui.audioFormat, { sampleRate: 48000, channelCount: 2 });
    assert.equal(snapshotCount, 0, 'format publication alone must not analyze a partial pipeline');
    assert.equal(workers.length, 0);

    audioManager.dispatchEvent('pipelineChanged');
    await nextTask();
    await nextTask();
    assert.equal(snapshotCount, 1);
    assert.equal(workers.length, 1);
    assert.equal(workers[0].requests.length, 1);
    controller.dispose();
});

test('output rows remain between one and the current capacity', () => {
    const controller = new PipelineAnalyzerController({
        audioManager: new FakeAudioManager(3),
        workletSync: { preparePluginData: () => ({}) },
        ui: new FakeUi(),
        storage: null
    });
    controller.initialize();
    assert.equal(controller.removeOutput(0), false);
    assert.equal(controller.addOutput(), true);
    assert.equal(controller.addOutput(), true);
    assert.equal(controller.addOutput(), false);
    assert.deepEqual(controller.state.outputs.map(output => output.channel), [0, 1, 2]);
    assert.equal(controller.removeOutput(1), true);
    assert.deepEqual(controller.state.outputs.map(output => output.channel), [0, 2]);
    controller.dispose();
});

test('measurement settings are bounded, persisted, and invalidate without graph-view reruns', () => {
    const writes = [];
    const controller = new PipelineAnalyzerController({
        audioManager: new FakeAudioManager(),
        workletSync: { preparePluginData: () => ({}) },
        ui: new FakeUi(),
        storage: {
            getItem: () => null,
            setItem: (key, value) => writes.push([key, JSON.parse(value)])
        },
        debounceMs: 1000
    });
    controller.active = true;
    const initialGeneration = controller.runGeneration;
    controller.setGraphView('phase');
    assert.equal(controller.runGeneration, initialGeneration);
    controller.setConfiguration({
        measurementSettings: {
            signalType: 'impulse',
            levelDb: -100,
            sequenceLength: 123,
            stabilizationPeriods: 99,
            averagingPeriods: 0
        }
    });
    assert.deepEqual(controller.state.measurementSettings, {
        signalType: 'impulse',
        levelDb: -60,
        sequenceLength: 65535,
        stabilizationPeriods: 32,
        averagingPeriods: 1
    });
    assert.equal(controller.runGeneration, initialGeneration + 1);
    assert.deepEqual(writes.at(-1)[1].measurementSettings, controller.state.measurementSettings);
    controller.setConfiguration({
        measurementSettings: {
            signalType: 'tsp',
            levelDb: -18,
            sequenceLength: 131072,
            stabilizationPeriods: 4,
            averagingPeriods: 3
        }
    });
    assert.deepEqual(controller.state.measurementSettings, {
        signalType: 'tsp',
        levelDb: -18,
        sequenceLength: 131072,
        stabilizationPeriods: 4,
        averagingPeriods: 3
    });
    assert.deepEqual(writes.at(-1)[1].measurementSettings, controller.state.measurementSettings);
    controller.dispose();
});

test('pipeline events refresh format before one invalidation and adjacent events coalesce', async () => {
    const audioManager = new FakeAudioManager(2);
    const ui = new FakeUi();
    const workers = [];
    const controller = new PipelineAnalyzerController({
        audioManager,
        workletSync: { preparePluginData: () => ({}) },
        ui,
        storage: null,
        openMeasurementStore: () => new Promise(() => {}),
        snapshotBuilder: async () => builtSnapshot(),
        createWorker: () => {
            const worker = new FakeWorker();
            workers.push(worker);
            return worker;
        },
        debounceMs: 10
    });
    controller.setOpen(true);
    await new Promise(resolve => setTimeout(resolve, 20));
    const baselineWorkers = workers.length;
    const baselineGeneration = controller.runGeneration;
    audioManager.contextManager.audioContext.sampleRate = 96000;
    audioManager.dispatchEvent('pipelineChanged');
    assert.deepEqual(ui.audioFormat, { sampleRate: 96000, channelCount: 2 });
    assert.equal(controller.runGeneration, baselineGeneration + 1);
    audioManager.dispatchEvent('audioGraphRebuilt');
    assert.equal(controller.runGeneration, baselineGeneration + 2);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(workers.length, baselineWorkers + 1);
    controller.dispose();
});

test('Auto off suppresses pipeline-triggered measurements while manual refresh still measures', async () => {
    const audioManager = new FakeAudioManager(2);
    const ui = new FakeUi();
    const workers = [];
    const store = {
        async refresh() {},
        listMeasurements() { return []; },
        close() {}
    };
    const controller = new PipelineAnalyzerController({
        audioManager,
        workletSync: { preparePluginData: () => ({}) },
        ui,
        storage: null,
        openMeasurementStore: async () => store,
        snapshotBuilder: async () => builtSnapshot(),
        createWorker: () => {
            const worker = new FakeWorker(true);
            workers.push(worker);
            return worker;
        },
        debounceMs: 0
    });
    controller.setConfiguration({ autoRefresh: false });
    controller.setOpen(true);
    await nextTask();
    await nextTask();
    const baselineWorkers = workers.length;

    audioManager.dispatchEvent('pipelineAnalysisInvalidated', { reason: 'pipeline-full-update' });
    audioManager.dispatchEvent('pipelineChanged');
    audioManager.dispatchEvent('audioGraphRebuilt');
    await nextTask();
    await nextTask();
    assert.equal(workers.length, baselineWorkers);
    assert.equal(ui.measuringStates.at(-1), false);

    assert.equal(await controller.refreshMeasurements(), true);
    await nextTask();
    await nextTask();
    assert.equal(workers.length, baselineWorkers + 1);
    controller.dispose();
});

test('Auto off still allows manual analysis when the Measurement Store is unavailable', async () => {
    const audioManager = new FakeAudioManager(2);
    const ui = new FakeUi();
    const workers = [];
    const controller = new PipelineAnalyzerController({
        audioManager,
        workletSync: { preparePluginData: () => ({}) },
        ui,
        storage: null,
        openMeasurementStore: async () => null,
        snapshotBuilder: async () => builtSnapshot(),
        createWorker: () => {
            const worker = new FakeWorker(true);
            workers.push(worker);
            return worker;
        },
        debounceMs: 0
    });
    controller.setConfiguration({ autoRefresh: false });
    controller.setOpen(true);
    await nextTask();
    await nextTask();
    const baselineWorkers = workers.length;

    audioManager.dispatchEvent('pipelineChanged');
    await nextTask();
    assert.equal(workers.length, baselineWorkers);
    assert.equal(await controller.refreshMeasurements(), true);
    await nextTask();
    await nextTask();
    assert.equal(workers.length, baselineWorkers + 1);
    controller.dispose();
});

test('DSP telemetry invalidates only active plugin ID-set changes and unsubscribes on close', () => {
    const audioManager = new FakeAudioManager();
    let states = [
        { pluginId: 2, state: 'active' },
        { pluginId: 3, state: 'pending' }
    ];
    audioManager.getDspExecutionStateSnapshot = () => ({ states });
    const controller = new PipelineAnalyzerController({
        audioManager,
        workletSync: { preparePluginData: () => ({}) },
        ui: new FakeUi(),
        storage: null,
        openMeasurementStore: () => new Promise(() => {}),
        snapshotBuilder: async () => builtSnapshot(),
        createWorker: () => new FakeWorker(),
        debounceMs: 1000
    });
    const publish = nextStates => {
        states = nextStates;
        audioManager.dispatchEvent('dspExecutionState');
    };

    controller.setOpen(true);
    let generation = controller.runGeneration;
    publish([
        { pluginId: 2, state: 'active' },
        { pluginId: 3, state: 'bypassed' }
    ]);
    assert.equal(controller.runGeneration, generation);

    publish([
        { pluginId: 3, state: 'active' },
        { pluginId: 2, state: 'active' }
    ]);
    assert.equal(controller.runGeneration, ++generation);
    publish([
        { pluginId: 2, state: 'active' },
        { pluginId: 3, state: 'active' }
    ]);
    assert.equal(controller.runGeneration, generation);
    publish([
        { pluginId: 2, state: 'bypassed' },
        { pluginId: 3, state: 'active' }
    ]);
    assert.equal(controller.runGeneration, ++generation);
    publish([
        { pluginId: 2, state: 'pending' },
        { pluginId: 3, state: 'active' }
    ]);
    assert.equal(controller.runGeneration, generation);

    controller.setOpen(false);
    assert.equal(audioManager.listeners.get('dspExecutionState')?.size, 0);
    const closedGeneration = controller.runGeneration;
    publish([{ pluginId: 2, state: 'active' }]);
    assert.equal(controller.runGeneration, closedGeneration);

    controller.setOpen(true);
    assert.equal(audioManager.listeners.get('dspExecutionState')?.size, 1);
    controller.dispose();
    assert.equal(audioManager.listeners.get('dspExecutionState')?.size, 0);
});

test('a run freezes current active DSP instances as optional WASM preferences', async () => {
    let snapshotOptions = null;
    const audioManager = new FakeAudioManager();
    audioManager.getDspExecutionStateSnapshot = () => Object.freeze({
        revision: 4,
        states: Object.freeze([
            Object.freeze({ pluginId: 2, state: 'active' }),
            Object.freeze({ pluginId: 3, state: 'pending' }),
            Object.freeze({ pluginId: 4, state: 'bypassed' })
        ])
    });
    const controller = new PipelineAnalyzerController({
        audioManager,
        workletSync: { preparePluginData: () => ({}) },
        ui: new FakeUi(),
        storage: null,
        openMeasurementStore: () => new Promise(() => {}),
        snapshotBuilder: async options => {
            snapshotOptions = options;
            return builtSnapshot();
        },
        createWorker: () => new FakeWorker(),
        debounceMs: 0
    });
    controller.setOpen(true);
    await nextTask();
    await nextTask();
    assert.deepEqual(snapshotOptions.preferredWasmPluginIds, [2]);
    assert.equal(Object.isFrozen(snapshotOptions.preferredWasmPluginIds), true);
    controller.dispose();
});

test('measurement refresh failures preserve the accepted result and log once', async () => {
    const ui = new FakeUi();
    const diagnostics = [];
    const controller = new PipelineAnalyzerController({
        audioManager: new FakeAudioManager(),
        workletSync: { preparePluginData: () => ({}) },
        ui,
        storage: null,
        consoleRef: { error: (...args) => diagnostics.push(args) }
    });
    controller.active = true;
    controller.measurementStore = {
        async refresh() { throw new Error('private store detail'); }
    };
    controller.lastAcceptedResult = Object.freeze({ views: {} });
    assert.equal(await controller.refreshMeasurements(), false);
    assert.equal(ui.measuringStates.at(-1), false);
    assert.equal(controller.lastAcceptedStale, false);
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0][1].code, 'measurement-refresh-failed');
    controller.dispose();
});
