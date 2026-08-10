import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { AudioManager } from '../../js/audio-manager.js';
import { DSP_PARAM_PACKERS } from '../../js/audio/dsp-params.generated.js';
import { updateApplicationMenu } from '../../js/electron/menuIntegration.js';
import { createPluginProcessorHost } from '../../js/pipeline-analyzer/analysis-worker.js';
import { PipelineAnalyzerController } from '../../js/pipeline-analyzer/controller.js';
import { PipelineWorkletSync } from '../../js/ui/pipeline/pipeline-worklet-sync.js';

function assetHarness(state = 3) {
    const manager = Object.create(AudioManager.prototype);
    const worklet = { port: {} };
    const pluginId = 17;
    const slot = 0;
    const key = `${pluginId}:${slot}`;
    const payload = new ArrayBuffer(8);
    const listeners = new Set();
    const graphListeners = new Map();
    const descriptor = { operationRevision: 4, footprintBytes: 8, payload };
    const plugin = {
        id: pluginId,
        getWasmAssets: () => new Map([[slot, descriptor]]),
        getWasmAssetRevisionDescriptor(requestedSlot, revision) {
            if (requestedSlot !== slot || revision !== 4) return null;
            return { ...descriptor, payload: payload.slice(0) };
        },
        getWasmAssetLastRejection: () => ({
            operationRevision: 5,
            residentRetained: true,
            retainedOperationRevision: 4,
            reason: 'invalid-asset'
        }),
        addWasmAssetSnapshotChangeListener(callback) {
            listeners.add(callback);
            return () => listeners.delete(callback);
        }
    };
    manager.contextManager = { workletNode: worklet };
    manager._audioGraphGeneration = 1;
    manager._wasmAssetMembershipByNode = new Map([[worklet, new Map([[pluginId, plugin]])]]);
    manager._wasmAssetStatesByNode = new Map([[worklet, new Map([[key, state]])]]);
    manager._wasmAssetExpectedRevisionsByNode = new Map([[worklet, new Map([[key, 4]])]]);
    manager._wasmAssetExpectedReplayEpochsByNode = new Map([[worklet, new Map([[key, null]])]]);
    manager.addEventListener = (name, callback) => {
        let entries = graphListeners.get(name);
        if (!entries) {
            entries = new Set();
            graphListeners.set(name, entries);
        }
        entries.add(callback);
    };
    manager.removeEventListener = (name, callback) => graphListeners.get(name)?.delete(callback);
    return {
        manager,
        plugin,
        worklet,
        key,
        payload,
        notify: () => {
            for (const listener of listeners) listener();
        }
    };
}

function dspExecutionHarness() {
    class OptionalPlugin {
        static executionCapabilities = Object.freeze({ requiresWasm: false });
        constructor(id) { this.id = id; }
        onMessage(message) { this.lastMessage = message; }
    }
    const manager = Object.create(AudioManager.prototype);
    const worklet = { port: {} };
    const first = new OptionalPlugin(17);
    const second = new OptionalPlugin(18);
    manager.contextManager = { workletNode: worklet };
    manager.pipelineA = [first, second];
    manager.pipelineB = null;
    manager.pipeline = manager.pipelineA;
    manager.pipelineProcessor = {
        prepareSectionAwarePluginData: () => manager.pipeline.map(plugin => ({
            id: plugin.id,
            type: plugin.constructor.name,
            executionCapabilities: OptionalPlugin.executionCapabilities,
            wasmParams: new Float32Array([1])
        }))
    };
    manager.getEnabledDspTypes = () => [OptionalPlugin.name];
    manager._audioGraphGeneration = 3;
    manager._primaryWorkletEpoch = 2;
    manager._topologyRevision = 4;
    manager._dspExecutionGenerationsByNode = new Map();
    manager._dspExecutionStateRevision = 0;
    manager._dspExecutionStateOwner = null;
    manager._dspExecutionStates = new Map();
    manager._isActiveDspWorklet = node => node === worklet;
    manager.dispatchEvent = () => {};
    return { manager, worklet, first, second, OptionalPlugin };
}

test('effective-active asset snapshot returns only the primary active revision and copies payloads', () => {
    const harness = assetHarness(3);
    const snapshot = harness.manager.getEffectiveActiveWasmAssetSnapshot(harness.plugin, [0]);
    assert.equal(snapshot.ready, true);
    assert.equal(snapshot.revisions.get(0).operationRevision, 4);
    assert.equal(snapshot.rejectedCandidates.get(0).retainedOperationRevision, 4);
    assert.notEqual(snapshot.assets.get(0).payload, harness.payload);
    assert.equal(snapshot.assets.get(0).payload.byteLength, harness.payload.byteLength);
});

test('effective-active barrier waits for the primary state and returns the exact active revision', async () => {
    const harness = assetHarness(1);
    const pending = harness.manager.waitForEffectiveActiveWasmAssets(
        harness.plugin,
        [0],
        { timeoutMs: 1000 }
    );
    harness.manager._wasmAssetStatesByNode.get(harness.worklet).set(harness.key, 3);
    harness.notify();
    const snapshot = await pending;
    assert.equal(snapshot.ready, true);
    assert.deepEqual(snapshot.pendingSlots, []);
    assert.equal(snapshot.revisions.get(0).operationRevision, 4);
});

test('optional DSP telemetry preserves pending and rollout-disabled primary states', () => {
    const { manager, worklet, first, second, OptionalPlugin } = dspExecutionHarness();
    manager.getEnabledDspTypes = () => [];
    manager.handleWorkletMessage({ data: {
        type: 'dspExecutionState',
        pluginId: first.id,
        pluginType: OptionalPlugin.name,
        state: 'pending',
        reason: null,
        generation: 5
    } }, worklet);
    manager.handleWorkletMessage({ data: {
        type: 'dspExecutionState',
        pluginId: second.id,
        pluginType: OptionalPlugin.name,
        state: 'bypassed',
        reason: 'rolloutDisabled',
        generation: 5
    } }, worklet);

    const snapshot = manager.getDspExecutionStateSnapshot();
    assert.equal(Object.isFrozen(snapshot), true);
    assert.equal(Object.isFrozen(snapshot.states), true);
    assert.deepEqual(snapshot.states.map(state => [state.pluginId, state.state]), [
        [17, 'pending'],
        [18, 'bypassed']
    ]);
    assert.equal(snapshot.states[1].reason, 'rolloutDisabled');
    assert.equal(first.lastMessage.validated, true);
    const controller = Object.create(PipelineAnalyzerController.prototype);
    controller.audioManager = manager;
    assert.deepEqual(controller._getPreferredWasmPluginIds(), []);

    manager._topologyRevision += 1;
    assert.deepEqual(manager.getDspExecutionStateSnapshot().states, []);
});

test('a newer DSP execution generation replaces the incomplete prior revision', () => {
    const { manager, worklet, first, second, OptionalPlugin } = dspExecutionHarness();
    for (const plugin of [first, second]) {
        manager.handleWorkletMessage({ data: {
            type: 'dspExecutionState',
            pluginId: plugin.id,
            pluginType: OptionalPlugin.name,
            state: 'active',
            reason: null,
            generation: 8
        } }, worklet);
    }
    manager.handleWorkletMessage({ data: {
        type: 'dspExecutionState',
        pluginId: second.id,
        pluginType: OptionalPlugin.name,
        state: 'pending',
        reason: null,
        generation: 9
    } }, worklet);
    assert.deepEqual(manager.getDspExecutionStateSnapshot().states.map(state => ({
        pluginId: state.pluginId,
        state: state.state
    })), [{ pluginId: 18, state: 'pending' }]);
});

test('active optional Worklet telemetry reaches Analyzer preferences only for prepared DSP payloads', async () => {
    const pluginId = 403;
    const pluginType = 'MultibandExpanderPlugin';
    const packer = DSP_PARAM_PACKERS.get(pluginType);
    const prepared = {
        id: pluginId,
        type: pluginType,
        enabled: true,
        parameters: {},
        inputBus: 0,
        outputBus: 0,
        channel: null,
        executionCapabilities: { requiresWasm: false },
        wasmParams: packer.pack({}),
        wasmParamsHash: packer.hash
    };
    const host = await createPluginProcessorHost(48000, 1);
    host.send({
        type: 'updateAudioConfig',
        outputChannels: 1,
        sampleRate: 48000,
        lowLatencyMode: true
    });
    host.send({
        type: 'registerProcessor',
        pluginType,
        processor: 'return data;'
    });
    const wasmFile = fs.readFileSync(
        new URL('../../plugins/dsp/effetune-dsp.wasm', import.meta.url)
    );
    host.send({
        type: 'dspModule',
        bytes: Uint8Array.from(wasmFile).buffer,
        simd: false
    });
    await host.waitFor(message => message?.type === 'dspReady');
    host.send({ type: 'dspEnableTypes', types: [pluginType] });
    host.send({ type: 'updatePlugins', plugins: [prepared], masterBypass: false });
    for (let attempt = 0; attempt < 32 && !host.messages.some(message =>
        message?.type === 'dspExecutionState' && message.pluginId === pluginId &&
        message.state === 'active'); attempt += 1) {
        host.processZeroBlock(1);
        await Promise.resolve();
    }
    const workletStates = host.messages.filter(message =>
        message?.type === 'dspExecutionState' && message.pluginId === pluginId
    );
    assert.equal(workletStates.at(-1)?.state, 'active');

    class MultibandExpanderPlugin {
        static executionCapabilities = Object.freeze({ requiresWasm: false });
        constructor() { this.id = pluginId; }
        onMessage(message) { this.lastMessage = message; }
    }
    const plugin = new MultibandExpanderPlugin();
    const manager = Object.create(AudioManager.prototype);
    const worklet = { port: {} };
    manager.contextManager = { workletNode: worklet };
    manager.pipeline = [plugin];
    manager.pipelineA = manager.pipeline;
    manager.pipelineB = null;
    manager.pipelineProcessor = { prepareSectionAwarePluginData: () => [prepared] };
    manager.getEnabledDspTypes = () => [pluginType];
    manager._audioGraphGeneration = 1;
    manager._primaryWorkletEpoch = 1;
    manager._topologyRevision = 1;
    manager._dspExecutionGenerationsByNode = new Map();
    manager._dspExecutionStateRevision = 0;
    manager._dspExecutionStateOwner = null;
    manager._dspExecutionStates = new Map();
    manager._isActiveDspWorklet = node => node === worklet;
    manager.dispatchEvent = () => {};
    for (const state of workletStates) {
        manager.handleWorkletMessage({ data: state }, worklet);
    }
    const controller = Object.create(PipelineAnalyzerController.prototype);
    controller.audioManager = manager;
    assert.deepEqual(controller._getPreferredWasmPluginIds(), [pluginId]);

    manager._resetDspExecutionStateSnapshot();
    manager.pipelineProcessor.prepareSectionAwarePluginData = () => [{
        ...prepared,
        wasmParams: undefined
    }];
    manager.handleWorkletMessage({ data: workletStates.at(-1) }, worklet);
    assert.deepEqual(controller._getPreferredWasmPluginIds(), []);

    manager.pipelineProcessor.prepareSectionAwarePluginData = () => [{
        ...prepared,
        enabled: false
    }];
    manager.handleWorkletMessage({ data: workletStates.at(-1) }, worklet);
    assert.deepEqual(controller._getPreferredWasmPluginIds(), []);
});

test('worklet sync publishes structural invalidation even when no live worklet exists', () => {
    const previousWindow = globalThis.window;
    globalThis.window = { uiManager: null };
    try {
        const events = [];
        const audioManager = {
            pipeline: [],
            masterBypass: false,
            getActivePowerWorklets: () => [],
            dispatchEvent: (name, detail) => events.push([name, detail])
        };
        const sync = new PipelineWorkletSync({ audioManager });
        sync.updateWorkletPlugins();
        sync.updateMasterBypass(true);
        sync.removePlugin(4);
        assert.deepEqual(events, [
            ['pipelineAnalysisInvalidated', { reason: 'pipeline-full-update' }],
            ['pipelineAnalysisInvalidated', { reason: 'pipeline-master-bypass' }],
            ['pipelineAnalysisInvalidated', { reason: 'pipeline-plugin-remove' }]
        ]);
    } finally {
        globalThis.window = previousWindow;
    }
});

test('Electron View menu mirrors restored Analyzer state and rebuilds localized labels', async () => {
    const previousWindow = globalThis.window;
    const templates = [];
    let language = 'en';
    const labels = {
        en: 'Pipeline Analyzer',
        ja: 'パイプラインアナライザー'
    };
    const uiManager = {
        pipelineAnalyzerController: { state: { open: true } },
        isDoubleBlindActive: () => false,
        t(key) {
            return key === 'menu.view.pipelineAnalyzer' ? labels[language] : key;
        }
    };
    globalThis.window = {
        uiManager,
        electronAPI: {
            async updateApplicationMenu(template) {
                templates.push(template);
                return { success: true };
            },
            async getUserPresetsForTray() {
                return { success: true, presets: [] };
            },
            async updateTrayMenu() {
                return { success: true };
            }
        }
    };
    try {
        await updateApplicationMenu(true);
        const restoredItem = templates.at(-1).view.submenu[8];
        assert.deepEqual(restoredItem, {
            label: labels.en,
            type: 'checkbox',
            checked: true
        });

        uiManager.pipelineAnalyzerController.state.open = false;
        language = 'ja';
        await updateApplicationMenu(true);
        const rebuiltItem = templates.at(-1).view.submenu[8];
        assert.equal(rebuiltItem.label, labels.ja);
        assert.equal(rebuiltItem.checked, false);
    } finally {
        globalThis.window = previousWindow;
    }
});

test('Electron main menu forwards the checkbox absolute value without persistent main state', () => {
    const source = fs.readFileSync(new URL('../../electron/ipc-handlers.js', import.meta.url), 'utf8');
    assert.match(source, /label: menuTemplate\.view\.submenu\[8\]\.label,[\s\S]*type: 'checkbox',[\s\S]*checked: menuTemplate\.view\.submenu\[8\]\.checked === true/);
    assert.match(source, /webContents\.send\('set-pipeline-analyzer-open', menuItem\.checked === true\)/);
    assert.match(source, /label: 'Pipeline Analyzer',[\s\S]*type: 'checkbox',[\s\S]*checked: false/);
    assert.doesNotMatch(source, /pipelineAnalyzer(?:Open|Checked)\s*=/);
});

test('UI audio initialization refreshes Analyzer format without starting a measurement', () => {
    const source = fs.readFileSync(new URL('../../js/ui-manager.js', import.meta.url), 'utf8');
    assert.match(source, /initAudio\(\)\s*\{[\s\S]*?if \(this\.audioManager\.audioContext\) \{\s*this\.pipelineAnalyzerController\?\.refreshAudioFormat\?\.\(\);/);
    assert.doesNotMatch(source, /initAudio\(\)\s*\{[\s\S]{0,300}pipelineAnalyzerController\?\.invalidate/);
});
