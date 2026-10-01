import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { activatePipelineModels, createPipelineModels, getPresetPluginStates, serializePipeline, validatePreset } from '../../extension/model.js';
import { applySerializedState, convertShortToLongFormat } from '../../js/utils/serialization-utils.js';
import { buildDspPipelineDescriptor } from '../../js/audio/dsp-pipeline-descriptor.js';
import { DSP_PARAM_PACKERS } from '../../js/audio/dsp-params.generated.js';
import { instantiateDsp } from '../../js/audio/dsp-wasm-loader.js';
import { decidePowerTarget } from '../../js/audio/power-policy.js';
import { ExtensionIrLibraryClient, ExtensionIrLibraryHost } from '../../extension/ir-library.js';
import { IrLibraryService } from '../../js/ir-library/service.js';
import { IrLibraryStore } from '../../js/ir-library/ir-library-store.js';
import { AudioManager } from '../../js/audio-manager.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';
import {
    publishStateThenDspExecution,
    replayDspExecutionStates,
    routeOffscreenWorkletMessage,
    validateDspExecutionMessage
} from '../../extension/execution-state-bridge.js';
import { parseTelemetryPacket, TelemetryFrameType } from '../../js/audio/telemetry-hub.js';
import {
    matchesExactEvaluationError,
    waitAndConsumeExpectedRuntimeConsoleError
} from '../../tools/run-extension-browser-smoke.mjs';

test('extension activation replays disabled assets but waits only for reachable enabled effects', async () => {
    class Effect {
        constructor(id, enabled = true) { this.id = id; this.enabled = enabled; }
        getWorkletPluginData() { return { id: this.id, enabled: this.enabled }; }
    }
    class SectionPlugin extends Effect {}
    const active = new Effect(1);
    const disabledIr = new Effect(2, false);
    const disabledSection = new SectionPlugin(3, false);
    const sectionFilter = new Effect(4);
    const plugins = [active, disabledIr, disabledSection, sectionFilter];
    const payloads = [];
    const waits = [];
    const audio = {
        masterBypass: false,
        workletNode: {},
        commitPowerTopologyMutation(message) { payloads.push(message); },
        syncPrimaryWasmAssetMembership(members) { assert.equal(members, plugins); },
        _replayPipelineWasmAssets(node, members, options) {
            assert.equal(node, this.workletNode);
            assert.equal(members, plugins);
            assert.equal(options.trackState, true);
            return new Set(options.assetReadinessPlugins.map(plugin => plugin.id));
        },
        async _waitForWasmAssetsActive(node, expected) {
            waits.push([...expected]);
            // Disabled filters remain PREPARING because they do not process blocks.
            return [...expected].every(id => id === active.id);
        },
        async _requestWorkletLatency() { return { latencySamples: 128 }; },
        getDspExecutionStateSnapshot() {
            return { states: [{ pluginId: active.id, state: 'active' }] };
        }
    };
    await activatePipelineModels(audio, plugins);
    assert.deepEqual(waits, [[active.id]]);
    assert.deepEqual(payloads[0].plugins.map(plugin => plugin.id), [1, 2, 3, 4]);
    let topologyRevision = 1;
    let confirmations = 0;
    audio.getDspExecutionStateSnapshot = () => ({
        topologyRevision,
        states: confirmations === 1 ? [] : [{ pluginId: active.id, state: 'active' }]
    });
    audio._requestWorkletLatency = async () => {
        confirmations++;
        if (confirmations === 1) topologyRevision++;
        return { latencySamples: 128 };
    };
    await activatePipelineModels(audio, plugins);
    assert.equal(confirmations, 2, 'completion-side parameter changes require another ordered confirmation');
    audio.masterBypass = true;
    await activatePipelineModels(audio, plugins);
    assert.deepEqual(waits.at(-1), []);
    assert.equal(payloads.at(-1).masterBypass, true);

    audio.masterBypass = false;
    disabledIr.enabled = true;
    await assert.rejects(activatePipelineModels(audio, plugins), /effect filters could not be activated/);
    assert.deepEqual(waits.at(-1), [1, 2]);
});

test('smoke fault consumer waits for its exact delayed error and preserves unrelated errors', async () => {
    const expected = 'Editor update failed: Error: Expected failure.';
    const unrelated = 'Editor update failed: Error: An unrelated update failed.';
    const runtime = { consoleErrors: [unrelated] };
    setTimeout(() => runtime.consoleErrors.push(expected), 10);

    await waitAndConsumeExpectedRuntimeConsoleError(
        runtime, value => value === expected, 'expected failure', 200
    );

    assert.deepEqual(runtime.consoleErrors, [unrelated]);
});

test('smoke fault consumer rejects duplicate exact errors without consuming them', async () => {
    const expected = 'Editor update failed: Error: Expected failure.';
    const unrelated = 'Editor update failed: Error: An unrelated update failed.';
    const runtime = { consoleErrors: [expected, unrelated, expected] };

    await assert.rejects(
        waitAndConsumeExpectedRuntimeConsoleError(
            runtime, value => value === expected, 'expected failure', 100
        ),
        /Expected one expected failure console error, received 2 exact matches\./
    );
    assert.deepEqual(runtime.consoleErrors, [expected, unrelated, expected]);
});

test('smoke fault consumer reports current errors when its exact error times out', async () => {
    const unrelated = 'Editor update failed: Error: An unrelated update failed.';
    const runtime = { consoleErrors: [unrelated] };

    await assert.rejects(
        waitAndConsumeExpectedRuntimeConsoleError(
            runtime, value => value === 'missing', 'missing failure', 40
        ),
        error => error.message.includes('Timed out waiting for missing failure console error.') &&
            error.message.includes(unrelated)
    );
    assert.deepEqual(runtime.consoleErrors, [unrelated]);
});

test('smoke rejection validator removes only the exact Playwright evaluation prefix', () => {
    const expected = 'These settings could not be applied.';
    assert.equal(matchesExactEvaluationError(new Error(expected), expected), true);
    assert.equal(matchesExactEvaluationError(
        new Error(`page.evaluate: Error: ${expected}\n    at ExtensionClient.request (protocol.js:1:1)`), expected
    ), true);
    assert.equal(matchesExactEvaluationError(
        new Error(`page.evaluate: Error: ${expected}\r\n    at ExtensionClient.request (protocol.js:1:1)`), expected
    ), true);
    assert.equal(matchesExactEvaluationError(new Error(`page.evaluate: Error: ${expected}`), expected), false);
    assert.equal(matchesExactEvaluationError(new Error('An unrelated error.'), expected), false);
    assert.equal(matchesExactEvaluationError(new Error('page.evaluate: Error: '), expected), false);
    assert.equal(matchesExactEvaluationError(
        new Error(`page.evaluate: Error: ${expected} Extra context.`), expected
    ), false);
    assert.equal(matchesExactEvaluationError(
        new Error(`page.evaluate: Error: ${expected}\nArbitrary details`), expected
    ), false);
    assert.equal(matchesExactEvaluationError(
        new Error(`page.evaluate: Error: page.evaluate: Error: ${expected}`), expected
    ), false);
});

test('extension execution bridge replays only AudioManager-validated current states', () => {
    const state = {
        pluginId: 7,
        pluginType: 'AMRadioSimulatorPlugin',
        state: 'active',
        reason: null,
        jsFallbackSampleChannels: 0,
        generation: 4
    };
    const snapshot = { states: [state] };
    const raw = { type: 'dspExecutionState', ...state };
    assert.deepEqual(validateDspExecutionMessage(raw, snapshot), { ...raw, validated: true });
    assert.equal(validateDspExecutionMessage({ ...raw, generation: 3 }, snapshot), null);
    assert.equal(validateDspExecutionMessage({ ...raw, pluginType: 'OtherPlugin' }, snapshot), null);

    const replayed = [];
    replayDspExecutionStates(snapshot, message => replayed.push(message));
    assert.deepEqual(replayed, [{ type: 'dspExecutionState', ...state, validated: true }]);
});

test('authoritative pipeline state installs the new editor model before execution replay', () => {
    const receivedBy = [];
    let currentEditor = { name: 'old', onMessage: () => receivedBy.push('old') };
    const execution = {
        pluginId: 9,
        pluginType: 'AMRadioSimulatorPlugin',
        state: 'active',
        reason: null,
        jsFallbackSampleChannels: 0,
        generation: 6
    };
    const audioManager = { getDspExecutionStateSnapshot: () => ({ states: [execution] }) };

    publishStateThenDspExecution(
        () => {
            currentEditor = { name: 'new', onMessage: message => receivedBy.push(`${message.validated}:${message.pluginId}`) };
            return { revision: 2 };
        },
        audioManager,
        message => currentEditor.onMessage(message)
    );

    assert.deepEqual(receivedBy, ['true:9']);
    assert.equal(currentEditor.name, 'new');
});

test('offscreen clones telemetry for viewers before AudioManager returns the transferable packet', () => {
    const frameTypes = Object.values(TelemetryFrameType);
    const packet = new ArrayBuffer(frameTypes.length * 16);
    const view = new DataView(packet);
    frameTypes.forEach((frameType, index) => {
        const offset = index * 16;
        view.setUint16(offset, frameType, true);
        view.setUint16(offset + 2, 1, true);
        view.setUint32(offset + 4, index + 1, true);
        view.setUint32(offset + 8, 1, true);
    });
    let published;
    let handled = false;
    routeOffscreenWorkletMessage({ type: 'dspTelemetry', packet, bytes: packet.byteLength }, {
        hasViewers: true,
        publish: message => { published = structuredClone(message); },
        handle: message => {
            structuredClone(message.packet, { transfer: [message.packet] });
            handled = true;
        },
        getExecutionSnapshot: () => ({ states: [] })
    });

    assert.equal(handled, true);
    assert.equal(packet.byteLength, 0);
    assert.equal(published.packet.byteLength, frameTypes.length * 16);
    const routedTypes = [];
    const parsed = parseTelemetryPacket(published.packet, published.bytes,
        frame => routedTypes.push(frame.frameType));
    assert.equal(parsed.ok, true);
    assert.deepEqual(routedTypes, frameTypes);
});

test('offscreen always returns telemetry packets even if viewer publication fails', () => {
    const packet = new ArrayBuffer(16);
    let handled = false;
    assert.throws(() => routeOffscreenWorkletMessage({ type: 'dspTelemetry', packet, bytes: 16 }, {
        hasViewers: true,
        publish: () => { throw new DOMException('clone failed', 'DataCloneError'); },
        handle: message => {
            structuredClone(message.packet, { transfer: [message.packet] });
            handled = true;
        },
        getExecutionSnapshot: () => ({ states: [] })
    }), /clone failed/);
    assert.equal(handled, true);
    assert.equal(packet.byteLength, 0);
});

test('offscreen clones transferable spectrum messages for two viewers before returning ownership', async () => {
    const channelName = `effetune-spectrum-${crypto.randomUUID()}`;
    const publisher = new BroadcastChannel(channelName);
    const receivers = [new BroadcastChannel(channelName), new BroadcastChannel(channelName)];
    const received = receivers.map(receiver => new Promise(resolve => {
        receiver.onmessage = event => resolve(event.data);
    }));
    const inputBuffer = Float32Array.of(0.25, 0.5);
    const outputBuffer = Float32Array.of(0.75, 1);
    const message = {
        type: 'spectrumOverlay', spectrumPluginId: 17, mode: 'compare', inputBuffer, outputBuffer
    };

    try {
        assert.doesNotThrow(() => routeOffscreenWorkletMessage(message, {
            hasViewers: true,
            publish: value => publisher.postMessage(value),
            handle: value => structuredClone(value, {
                transfer: [value.inputBuffer.buffer, value.outputBuffer.buffer]
            }),
            getExecutionSnapshot: () => ({ states: [] })
        }));
        assert.equal(inputBuffer.buffer.byteLength, 0);
        assert.equal(outputBuffer.buffer.byteLength, 0);
        const copies = await Promise.all(received);
        assert.deepEqual(copies.map(copy => ({
            type: copy.type,
            input: [...copy.inputBuffer],
            output: [...copy.outputBuffer]
        })), [
            { type: 'spectrumOverlay', input: [0.25, 0.5], output: [0.75, 1] },
            { type: 'spectrumOverlay', input: [0.25, 0.5], output: [0.75, 1] }
        ]);
    } finally {
        publisher.close();
        receivers.forEach(receiver => receiver.close());
    }
});

test('capture stop and failed startup close intentionally without triggering audio recovery', async () => {
    let resetCount = 0;
    const warnings = [];
    class CapturedAudioContext {
        constructor() {
            this.state = 'running';
            this.sampleRate = 48000;
            this.destination = { channelCount: 2, maxChannelCount: 2 };
            this.audioWorklet = {};
        }
        async close() {
            this.state = 'closed';
            this.onstatechange?.();
        }
        async resume() {}
    }
    await withGlobals({
        window: { AudioContext: CapturedAudioContext },
        document: { addEventListener() {}, removeEventListener() {} },
        console: { ...console, log() {}, warn: message => warnings.push(message) }
    }, async () => {
        for (const workletReady of [true, false]) {
            const audio = new AudioManager(null, { externalInput: true });
            audio.reset = async () => { resetCount++; };
            assert.equal(await audio.contextManager.initAudioContext({
                sampleRate: 48000, outputChannels: 2, lowLatencyOutput: true
            }), '');
            const context = audio.contextManager.audioContext;
            const track = { readyState: 'live', stop() { this.readyState = 'ended'; } };
            const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
            audio.ioManager.inputStream = stream;
            audio.ioManager.stream = stream;
            let disconnected = false;
            if (workletReady) {
                audio.contextManager.workletNode = { disconnect() { disconnected = true; } };
                window.workletNode = audio.contextManager.workletNode;
            }
            await audio.closeCapturedStream();
            assert.equal(resetCount, 0);
            assert.equal(context.state, 'closed');
            assert.equal(context.onstatechange, null);
            assert.equal(track.readyState, 'ended');
            assert.equal(audio.audioContext, null);
            assert.equal(audio.stream, null);
            assert.equal(audio.workletNode, null);
            assert.equal(window.audioContext, null);
            assert.equal(window.workletNode, null);
            assert.equal(disconnected, workletReady);
            assert.equal(audio.powerPolicyController.disposed, true);
        }
        assert.deepEqual(warnings, []);

        const audio = new AudioManager(null, { externalInput: true });
        audio.reset = async () => { resetCount++; };
        assert.equal(await audio.contextManager.initAudioContext({
            sampleRate: 48000, outputChannels: 2, lowLatencyOutput: true
        }), '');
        await audio.contextManager.audioContext.close();
        assert.equal(resetCount, 1);
        assert.ok(warnings.includes('[AudioContext] closed unexpectedly'));
        await audio.closeCapturedStream();
    });
});

test('extension presets preserve bus routing and reject unsupported topology before loading', () => {
    const previousWindow = globalThis.window;
    class VolumePlugin {}
    globalThis.window = { dspParamPackers: new Map([['VolumePlugin', {}]]) };
    const manager = { pluginClasses: { Volume: VolumePlugin }, isPluginAvailable: name => name === 'Volume' };
    try {
        const long = { pipeline: [{ name: 'Volume', enabled: true, parameters: { vl: -6 }, inputBus: 4, outputBus: 1, channel: 'L' }] };
        assert.deepEqual(getPresetPluginStates(long), [{ nm: 'Volume', en: true, vl: -6, ib: 4, ob: 1, ch: 'L' }]);
        assert.equal(validatePreset(long, manager)[0].vl, -6);
        for (const bus of [null, 0, 1, 2, 3, 4]) {
            const routed = { plugins: [{ nm: 'Volume', en: true, ib: bus, ob: bus }] };
            assert.deepEqual(validatePreset(routed, manager), routed.plugins);
        }
        for (const bus of [-1, 5, 1.5, '1']) {
            const invalid = { plugins: [{ nm: 'Volume', en: true, ib: bus }] };
            const before = structuredClone(invalid);
            assert.throws(() => validatePreset(invalid, manager), /invalid audio bus/);
            assert.deepEqual(invalid, before);
        }
        assert.throws(() => validatePreset({ plugins: [{ nm: 'Volume', ch: '34' }] }, manager), /channel/);
        assert.throws(() => validatePreset({ plugins: [{ nm: 'Unknown' }] }, manager), /unavailable/);
    } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
});

test('extension routed presets and live bus edits reach the stereo WASM pipeline', async () => {
    const windowRef = { dspParamPackers: DSP_PARAM_PACKERS, addEventListener() {} };
    const pluginContext = vm.createContext({
        window: windowRef, document: {}, console, Float32Array, setTimeout, clearTimeout,
        MutationObserver: class { observe() {} disconnect() {} }
    });
    for (const file of ['plugins/plugin-base.js', 'plugins/basics/volume.js']) {
        vm.runInContext(await readFile(new URL(`../../${file}`, import.meta.url), 'utf8'), pluginContext);
    }
    const manager = {
        nextPluginId: 1,
        pluginClasses: { Volume: windowRef.VolumePlugin },
        isPluginAvailable: name => name === 'Volume',
        createPlugin() { const plugin = new windowRef.VolumePlugin(); plugin.id = this.nextPluginId++; return plugin; }
    };
    await withGlobals({ window: windowRef }, async () => {
        const models = await createPipelineModels({ pipeline: [
            { name: 'Volume', enabled: true, parameters: { vl: 0 }, outputBus: 4 },
            { name: 'Volume', enabled: true, parameters: { vl: 0 }, inputBus: 4 }
        ] }, manager);
        const audio = { pipeline: models, masterBypass: false, audioContext: { sampleRate: 48000 } };
        windowRef.irLibraryService = { async refresh() {} };
        const sessionContext = vm.createContext({
            window: windowRef, console, Map, Promise, harnessAudio: audio, harnessManager: manager,
            serializePipeline, validatePreset, applySerializedState,
            capturePreparationStatuses: () => []
        });
        const sessionSource = (await readFile(new URL('../../extension/session.js', import.meta.url), 'utf8'))
            .replace(/^import .*;\r?\n/gm, '');
        vm.runInContext(sessionSource, sessionContext);
        vm.runInContext('audio = harnessAudio; manager = harnessManager; port = { postMessage() {} };', sessionContext);
        const binding = await instantiateDsp(await readFile(new URL('../../plugins/dsp/effetune-dsp.wasm', import.meta.url)));
        try {
            assert.notEqual(binding.createEngine(), 0);
            assert.equal(binding.prepare(48000, 2, 128, 256 * 1024), 0);
            const instances = new Map();
            for (const plugin of models) {
                const instance = binding.createInstance('VolumePlugin');
                assert.notEqual(instance, 0);
                instances.set(plugin.id, instance);
                const packer = DSP_PARAM_PACKERS.get('VolumePlugin');
                assert.equal(binding.instanceSetParams(instance, packer.pack(plugin.getParameters()), packer.hash), 0);
            }
            const assertOutput = expected => {
                const payload = models.map(plugin => plugin.getWorkletPluginData());
                assert.equal(binding.pipelineConfigure(buildDspPipelineDescriptor(payload, {
                    getInstanceId: plugin => instances.get(plugin.id)
                })), 0);
                const samples = binding.getArenaViews().combined.subarray(0, 256);
                samples.fill(0.25);
                assert.equal(binding.pipelineProcess(2, 128, 0, false), 0);
                for (const sample of samples) assert.equal(sample, expected);
            };
            assertOutput(0.5);
            const roundTrip = await createPipelineModels({
                pipeline: serializePipeline(models).map(convertShortToLongFormat)
            }, manager);
            assert.deepEqual(roundTrip.map(plugin => [plugin.inputBus, plugin.outputBus]), [[null, 4], [4, null]]);
            for (const plugin of roundTrip) plugin.cleanup();
            const updateRoute = async (index, inputBus, outputBus) => {
                const plugin = models[index].getWorkletPluginData();
                plugin.inputBus = inputBus;
                plugin.outputBus = outputBus;
                const state = await sessionContext.handle('workletMessage', { message: { type: 'updatePlugin', plugin } });
                assert.equal(state.plugins[index].ib, inputBus ?? undefined);
                assert.equal(state.plugins[index].ob, outputBus ?? undefined);
            };
            await updateRoute(0, null, 1);
            assertOutput(0.25);
            await updateRoute(1, 1, null);
            assertOutput(0.5);
            await updateRoute(0, null, null);
            await updateRoute(1, null, null);
            assertOutput(0.25);
        } finally {
            binding.close();
            for (const plugin of models) plugin.cleanup();
        }
    });
});

test('capture start fades the already flowing tab audio in instead of stepping the output gain', async () => {
    const calls = [];
    const audio = {
        pipeline: [], masterBypass: false, audioContext: { sampleRate: 48000, currentTime: 1 },
        workletNode: { port: { postMessage() {} } },
        pipelineProcessor: { setPipeline() {} },
        powerPolicyController: { subscribe() {}, handlePageLifecycleEvent() {} },
        ioManager: { outputGainNode: { gain: { setValueAtTime: () => calls.push('step') } } },
        async initializeCapturedStream() { calls.push('capture'); },
        setFrequencyPreview() {}, setVisualizerSources() {}, getDspExecutionStateSnapshot: () => [],
        fadeInOutputWhenReady: async () => calls.push('fadeIn')
    };
    const sessionContext = vm.createContext({
        window: { irLibraryService: { async refresh() {} }, addEventListener() {} }, console, Map, Promise, harnessAudio: audio,
        createPipelineModels: async () => [], activatePipelineModels: async () => {},
        replayDspExecutionStates() {}, serializePipeline: () => [], capturePreparationStatuses: () => []
    });
    const sessionSource = (await readFile(new URL('../../extension/session.js', import.meta.url), 'utf8'))
        .replace(/^import .*;\r?\n/gm, '');
    vm.runInContext(sessionSource, sessionContext);
    vm.runInContext('audio = harnessAudio; port = { postMessage() {} };', sessionContext);
    const state = await sessionContext.initializeAudio([], 48000, false);
    assert.equal(state.status, 'processing');
    assert.deepEqual(calls, ['capture', 'fadeIn']);
});

test('live capture remains in Monitoring past the full-suspend deadline without releasing input', () => {
    const identity = { policyGeneration: 1, topologyRevision: 1, workletGraphGeneration: 1, inputGeneration: 1 };
    const facts = {
        ...identity, enabled: true, isElectron: false, inputConfigured: true,
        inputRouteIntent: 'external-input', inputResourceState: 'live', inputAvailability: 'available',
        inputSourcePresent: true, pipelineInputConnected: true, transportDemand: false,
        visibility: 'hidden', hiddenSinceEpochMs: 0,
        routedInputSignalState: 'silent', routedOutputSignalState: 'silent', outputSignalState: 'silent',
        routedInputObservationFresh: true, routedOutputObservationFresh: true, workletObservationFresh: true,
        resourceHealth: 'healthy', resourcesKnown: true, temporalSkipEligible: true,
        monitoringFastWakeEligible: true, temporalMustProcess: false, effectiveState: 'MONITORING',
        workletObservedState: 'monitoring',
        automaticMonitoringArm: { state: 'consumed', commandId: 1, skipEpoch: 1, armAfterRenderSequence: 1 },
        routedInputSilentSinceEpochMs: 0, routedOutputSilentSinceEpochMs: 0,
        routedSilencePolicyGeneration: 1, routedSilenceTopologyRevision: 1,
        routedSilenceWorkletGraphGeneration: 1, routedSilenceInputGeneration: 1,
        routedSilenceRouteIntent: 'external-input', automaticSuspendAllowed: false
    };
    const result = decidePowerTarget(facts, { mode: 'maximum', fullSuspendDelaySeconds: 60 }, 600000);
    assert.equal(result.targetState, 'MONITORING');
    assert.equal(result.shouldReleaseInput, false);
    assert.equal(result.nextDeadlineAt, null);
    const generator = decidePowerTarget({ ...facts, temporalMustProcess: true }, { mode: 'maximum' }, 600000);
    assert.equal(generator.targetState, 'ACTIVE');
});

test('WASM-only worklets treat Sections as structure while retaining effect failure reports', async () => {
    const messages = [];
    let Processor;
    const source = await readFile(new URL('../../plugins/audio-processor.js', import.meta.url), 'utf8');
    vm.runInNewContext(source, {
        __EFFECTUNE_WASM_ONLY__: true, sampleRate: 48000, currentTime: 0,
        performance: { now: () => 0 }, console: { log() {}, warn() {}, error() {} },
        AudioWorkletProcessor: class { constructor() { this.port = { postMessage: message => messages.push(message) }; } },
        registerProcessor(name, value) { if (name === 'plugin-processor') Processor = value; }
    });
    const processor = new Processor({ processorOptions: { initialOutputChannelCount: 2 } });
    processor.dspEnableTypesReceived = true;
    for (const enabled of [true, false, true]) {
        processor.handlePortMessage({ type: 'updatePlugins', plugins: [
            { id: 1, type: 'SectionPlugin', enabled, parameters: {} },
            { id: 2, type: 'VolumePlugin', enabled: true, parameters: { vl: 0 } }
        ] });
        assert.equal(processor.plugins[0].executionCapabilities.requiresWasm, false);
        assert.equal(processor.plugins[1].executionCapabilities.requiresWasm, true);
    }
    const execution = messages.filter(message => message.type === 'dspExecutionState');
    assert.equal(execution.some(message => message.pluginId === 1), false);
    assert.ok(execution.some(message => message.pluginId === 2 && message.state === 'bypassed'));
});

function impulseFile(name, value) {
    const bytes = new Uint8Array(44 + 64);
    const view = new DataView(bytes.buffer);
    const text = (offset, value) => bytes.set(new TextEncoder().encode(value), offset);
    text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, 48000, true); view.setUint32(28, 96000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    text(36, 'data'); view.setUint32(40, 64, true); view.setInt16(44, value, true);
    return new File([bytes], name, { type: 'audio/wav' });
}

function memoryIrBackend() {
    const files = new Map();
    return {
        files,
        backend: {
            read: async name => files.get(name)?.slice() || null,
            exists: async name => files.has(name),
            writeAtomic: async (name, bytes) => files.set(name, new Uint8Array(bytes).slice()),
            remove: async name => files.delete(name),
            list: async () => [...files.keys()], cleanupTemporary: async () => {}
        }
    };
}

test('IR imports remain durable when browser persistence is denied or unavailable', async () => {
    for (const persistence of ['denied', 'rejected']) {
        const { files, backend } = memoryIrBackend();
        const diagnostics = [];
        const persistenceDiagnostics = [];
        let requests = 0;
        const store = await new IrLibraryStore(backend, {
            onDiagnostic: error => diagnostics.push(error),
            onPersistenceDiagnostic: error => persistenceDiagnostics.push(error),
            requestPersistence: () => {
                requests += 1;
                return persistence === 'denied'
                    ? Promise.resolve(false)
                    : Promise.reject(new Error('Persistence API unavailable'));
            }
        }).open();
        const first = await store.importSingle({ bytes: Uint8Array.of(1, 2, 3), fileName: 'first.wav' });
        await store.importSingle({ bytes: Uint8Array.of(4, 5, 6), fileName: 'second.wav' });
        await Promise.resolve();
        assert.equal(requests, 1);
        assert.deepEqual(diagnostics, []);
        assert.equal(persistenceDiagnostics.length, persistence === 'denied' ? 0 : 1);
        assert.ok(files.has('index.json'));
        assert.deepEqual(await store.readOriginal(first.entry.irId), Uint8Array.of(1, 2, 3));
        assert.equal((await new IrLibraryStore(backend, { onDiagnostic: error => diagnostics.push(error) }).open())
            .list().length, 2);
    }
});

test('Offscreen IR ownership preserves consecutive imports and applies them after the editor closes', async () => {
    const files = new Map();
    const backend = {
        read: async name => files.get(name)?.slice() || null,
        exists: async name => files.has(name),
        writeAtomic: async (name, bytes) => files.set(name, new Uint8Array(bytes).slice()),
        remove: async name => files.delete(name),
        list: async () => [...files.keys()], cleanupTemporary: async () => {}
    };
    const store = await new IrLibraryStore(backend).open();
    const service = new IrLibraryService(store);
    const host = new ExtensionIrLibraryHost(service, {
        decode: async bytes => ({ channels: [Float32Array.of(new DataView(bytes).getInt16(44, true) / 32768)], sampleRate: 48000 }),
        resample: async pcm => pcm, isInUse: () => false, onProgress() {}
    });
    const transport = new EventTarget();
    transport.request = (command, args) => {
        assert.equal(command, 'irLibrary');
        const cloned = structuredClone(args);
        if (cloned.method === 'importFiles') {
            // Node 22 clones File values as Blob values, matching the CI boundary that exposed lost File metadata.
            cloned.files = cloned.files.map(entry => ({ ...entry, file: new Blob([entry.file], { type: entry.file.type }) }));
        }
        return host.request(cloned, 'editor');
    };
    const editor = new ExtensionIrLibraryClient(transport);
    await editor.refresh();
    const first = (await editor.importFiles([impulseFile('first.wav', 16000)])).imported[0];
    assert.equal(service.get(first.irId).irId, first.irId);
    const second = (await editor.importFiles([impulseFile('second.wav', 24000)])).imported[0];
    await store.updateAnalysis(first.irId, { onsetFrame: 0, rt60: 0.5, peakDb: -6 });
    const reopened = await new IrLibraryStore(backend).open();
    assert.deepEqual(reopened.list().map(entry => entry.irId).sort(), [first.irId, second.irId].sort());
    const prepared = await host.request({ method: 'resolveDecodedPcm', irId: second.irId, sampleRate: 48000 }, null);
    assert.equal(prepared.value.channels[0][0], 24000 / 32768);
    assert.equal(prepared.entries.length, 2);
    await editor.store.updateAnalysis(second.irId, { onsetFrame: 0, rt60: 0.25, peakDb: -3 });
    assert.equal((await new IrLibraryStore(backend).open()).list().length, 2);
});
