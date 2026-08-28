import assert from 'node:assert/strict';
import test from 'node:test';

import {
    buildPipelineAnalyzerSnapshot,
    getAnalyzerAudioFormat,
    PipelineSnapshotError,
    StalePipelineAnalysisRunError
} from '../../js/pipeline-analyzer/pipeline-snapshot.js';
import {
    getPipelineAnalysisRequirements
} from '../../js/pipeline-analyzer/analysis-requirements.js';
import { buildAnalysisResult } from '../../js/pipeline-analyzer/analysis-core.js';

function plugin(type, id, options = {}) {
    const entry = {
        id,
        name: options.name || type,
        enabled: options.enabled !== false,
        constructor: { name: type },
        processorString: options.processorString || 'return data;',
        process() {},
        getWasmAssets: options.getWasmAssets || (() => new Map()),
        executionCapabilities: options.executionCapabilities,
        wasmParams: options.wasmParams
    };
    if (options.isOfflineDspAssetRequired) {
        entry.isOfflineDspAssetRequired = options.isOfflineDspAssetRequired;
    } else if (options.offlineDspAssetRequired !== undefined) {
        entry.offlineDspAssetRequired = options.offlineDspAssetRequired;
    }
    return entry;
}

function harness(entries, options = {}) {
    const prepared = [];
    const audioManager = {
        currentPipeline: options.pipelineIdentity || 'A',
        masterBypass: options.masterBypass === true,
        contextManager: {
            audioContext: {
                sampleRate: options.sampleRate || 48000,
                destination: { channelCount: options.channelCount || 2 }
            }
        },
        getCurrentPipeline: () => entries,
        getEnabledDspTypes: () => options.enabledDspTypes || [],
        dspModuleInfo: options.dspModuleInfo || null,
        waitForEffectiveActiveWasmAssets: options.waitForAssets
    };
    const workletSync = {
        preparePluginData(entry) {
            prepared.push(entry.id);
            return {
                id: entry.id,
                type: entry.constructor.name,
                enabled: entry.enabled,
                parameters: { gain: entry.id },
                inputBus: entry.inputBus ?? null,
                outputBus: entry.outputBus ?? null,
                channel: entry.channel ?? null,
                executionCapabilities: entry.executionCapabilities,
                ...(entry.wasmParams instanceof Float32Array
                    ? { wasmParams: new Float32Array(entry.wasmParams) }
                    : {})
            };
        }
    };
    return { audioManager, workletSync, prepared };
}

const identityConfiguration = {
    inputChannel: 0,
    slots: [
        { enabled: true, channel: 0, measurementId: null, pointId: null },
        { enabled: false, channel: 1, measurementId: null, pointId: null }
    ]
};

test('analyzer audio format accepts sixteen channels and rejects Ch 17', () => {
    const sixteen = harness([], { channelCount: 16 }).audioManager;
    const seventeen = harness([], { channelCount: 17 }).audioManager;
    assert.deepEqual(getAnalyzerAudioFormat(sixteen), { sampleRate: 48000, channelCount: 16 });
    assert.equal(getAnalyzerAudioFormat(seventeen), null);
});

test('requirements metadata accepts every type and derives required WASM from prepared data', () => {
    assert.deepEqual(getPipelineAnalysisRequirements(plugin('UnknownPlugin', 1)), {
        requiresWasm: false,
        requiredAssetSlots: [],
        warmupSamples: 0
    });
    assert.deepEqual(getPipelineAnalysisRequirements(plugin('UnknownWasmPlugin', 2), {
        executionCapabilities: { requiresWasm: true }
    }), {
        requiresWasm: true,
        requiredAssetSlots: [],
        warmupSamples: 0
    });

    const fixedFadeTypes = [
        'ChannelDividerPlugin',
        'FIRCrossoverPlugin',
        'FiveBandFIRPEQPlugin',
        'GroupDelayEqPlugin',
        'GroupDelayPEQPlugin',
        'MultibandBalancePlugin',
        'MultibandCompressorPlugin',
        'MultibandSaturationPlugin',
        'MultibandTransientPlugin',
        'RoomEqPlugin'
    ];
    for (const type of fixedFadeTypes) {
        assert.equal(getPipelineAnalysisRequirements(plugin(type, 3)).warmupSamples, 128);
    }
    const expanderWarmup = getPipelineAnalysisRequirements(
        plugin('MultibandExpanderPlugin', 4)
    ).warmupSamples;
    assert.equal(expanderWarmup({}, 48000), 240);
});

test('snapshot discards reset fades only before Unit Impulse measurements', async () => {
    const entries = [plugin('MultibandExpanderPlugin', 1)];
    const { audioManager, workletSync } = harness(entries);
    const build = measurementSettings => buildPipelineAnalyzerSnapshot({
        audioManager,
        workletSync,
        configuration: { ...identityConfiguration, measurementSettings },
        measurementStore: null,
        resolveRequirements: getPipelineAnalysisRequirements,
        isCurrent: () => true
    });

    const impulse = await build({ signalType: 'impulse' });
    const mls = await build({ signalType: 'mls' });
    const tsp = await build({ signalType: 'tsp', sequenceLength: 65536 });
    assert.equal(impulse.snapshot.warmupSamples, 256);
    assert.equal(mls.snapshot.warmupSamples, 0);
    assert.equal(tsp.snapshot.warmupSamples, 0);
    assert.equal(tsp.snapshot.measurementSettings.sequenceLength, 65536);

    const firHarness = harness([plugin('FIRCrossoverPlugin', 2)]);
    const firImpulse = await buildPipelineAnalyzerSnapshot({
        audioManager: firHarness.audioManager,
        workletSync: firHarness.workletSync,
        configuration: {
            ...identityConfiguration,
            measurementSettings: { signalType: 'impulse' }
        },
        measurementStore: null,
        resolveRequirements: getPipelineAnalysisRequirements,
        isCurrent: () => true
    });
    assert.equal(firImpulse.snapshot.warmupSamples, 128);
});

test('snapshot preserves the complete ordered payload while inspecting only effective entries', async () => {
    const entries = [
        plugin('LinearPlugin', 1),
        plugin('SectionPlugin', 2, { enabled: false }),
        plugin('UnknownPlugin', 3),
        plugin('SectionPlugin', 4, { enabled: true }),
        plugin('DisabledUnknownPlugin', 5, { enabled: false }),
        plugin('LinearPlugin', 6)
    ];
    const { audioManager, workletSync, prepared } = harness(entries);
    const result = await buildPipelineAnalyzerSnapshot({
        audioManager,
        workletSync,
        configuration: identityConfiguration,
        measurementStore: null,
        resolveRequirements: getPipelineAnalysisRequirements,
        isCurrent: () => true
    });

    assert.deepEqual(prepared, [1, 2, 3, 4, 5, 6]);
    assert.deepEqual(result.snapshot.plugins.map(entry => entry.id), [1, 2, 3, 4, 5, 6]);
    assert.deepEqual(result.snapshot.processors.map(entry => entry.pluginType), ['LinearPlugin']);
    assert.deepEqual(result.snapshot.outputChannels, [0]);
    assert.deepEqual(result.speakerResponses, [null]);
});

test('master bypass serializes every entry but skips processor and asset requirements', async () => {
    const entries = [plugin('IRReverbPlugin', 1, {
        offlineDspAssetRequired: true,
        executionCapabilities: { requiresWasm: false }
    })];
    const { audioManager, workletSync, prepared } = harness(entries, { masterBypass: true });
    const result = await buildPipelineAnalyzerSnapshot({
        audioManager,
        workletSync,
        configuration: identityConfiguration,
        resolveRequirements: getPipelineAnalysisRequirements,
        isCurrent: () => true
    });

    assert.deepEqual(prepared, [1]);
    assert.equal(result.snapshot.masterBypass, true);
    assert.deepEqual(result.snapshot.processors, []);
    assert.deepEqual(result.snapshot.assets, []);
    assert.deepEqual(result.snapshot.requiredWasmPluginIds, []);
    assert.equal(result.snapshot.dsp, null);
    assert.equal(result.snapshot.plugins[0].executionCapabilities.requiresWasm, false);
});

test('unknown and non-LTI effective plugins register their actual processors without classification', async () => {
    const types = [
        'UnknownPlugin',
        'NonlinearPlugin',
        'TimeVaryingPlugin',
        'RandomPlugin',
        'SourcePlugin'
    ];
    const entries = types.map((type, index) => plugin(type, index + 1));
    const { audioManager, workletSync } = harness(entries);
    const result = await buildPipelineAnalyzerSnapshot({
        audioManager,
        workletSync,
        configuration: identityConfiguration,
        resolveRequirements: getPipelineAnalysisRequirements,
        isCurrent: () => true
    });
    assert.deepEqual(result.snapshot.processors.map(entry => entry.pluginType), types);
});

test('identity routes do not require a Measurement Store, but requested IRs never fall back', async () => {
    const { audioManager, workletSync } = harness([]);
    const identity = await buildPipelineAnalyzerSnapshot({
        audioManager,
        workletSync,
        configuration: identityConfiguration,
        measurementStore: null,
        resolveRequirements: getPipelineAnalysisRequirements,
        isCurrent: () => true
    });
    assert.equal(identity.speakerResponses[0], null);

    await assert.rejects(
        buildPipelineAnalyzerSnapshot({
            audioManager,
            workletSync,
            configuration: {
                inputChannel: 0,
                slots: [{
                    enabled: true,
                    channel: 0,
                    measurementId: 'measurement',
                    pointId: 'point'
                }]
            },
            measurementStore: null,
            resolveRequirements: getPipelineAnalysisRequirements,
            isCurrent: () => true
        }),
        error => error.code === 'measurement-store-unavailable'
    );
});

test('speaker IR and asset awaits apply the run-current guard before retaining values', async () => {
    const assetPlugin = plugin('AssetPlugin', 9, {
        getWasmAssets: () => new Map([[0, { operationRevision: 3 }]])
    });
    let current = true;
    const { audioManager, workletSync } = harness([assetPlugin], {
        waitForAssets: async () => {
            current = false;
            return {
                ready: true,
                assets: new Map([[0, { operationRevision: 3, payload: new ArrayBuffer(4) }]]),
                revisions: new Map([[0, { operationRevision: 3 }]]),
                rejectedCandidates: new Map()
            };
        }
    });
    await assert.rejects(
        buildPipelineAnalyzerSnapshot({
            audioManager,
            workletSync,
            configuration: identityConfiguration,
            resolveRequirements: () => ({ requiredAssetSlots: [0] }),
            isCurrent: () => current
        }),
        StalePipelineAnalysisRunError
    );

    current = true;
    const irStore = {
        async getImpulseResponse() {
            current = false;
            return {
                data: new Float32Array([0, 1, 0]),
                sampleRate: 48000,
                onsetIndex: 1,
                refScale: 1
            };
        }
    };
    const empty = harness([]);
    await assert.rejects(
        buildPipelineAnalyzerSnapshot({
            audioManager: empty.audioManager,
            workletSync: empty.workletSync,
            configuration: {
                inputChannel: 0,
                slots: [{
                    enabled: true,
                    channel: 0,
                    measurementId: 'measurement',
                    pointId: 'point'
                }]
            },
            measurementStore: irStore,
            resolveRequirements: getPipelineAnalysisRequirements,
            isCurrent: () => current
        }),
        StalePipelineAnalysisRunError
    );
});

test('offline asset requirements are frozen and union slot zero only when required', async () => {
    const types = [
        'FIRCrossoverPlugin',
        'FiveBandFIRPEQPlugin',
        'GroupDelayEqPlugin',
        'GroupDelayPEQPlugin',
        'RoomEqPlugin',
        'IRReverbPlugin'
    ];
    const required = new Map();
    const entries = [];
    for (let index = 0; index < types.length; index += 1) {
        const type = types[index];
        const requiredId = index + 1;
        const optionalId = index + 11;
        required.set(requiredId, true);
        required.set(optionalId, false);
        entries.push(plugin(type, requiredId, {
            ...(type === 'IRReverbPlugin'
                ? { offlineDspAssetRequired: true }
                : { isOfflineDspAssetRequired: () => required.get(requiredId) }),
            executionCapabilities: { requiresWasm: false, owner: 'live' }
        }));
        entries.push(plugin(type, optionalId, {
            ...(type === 'IRReverbPlugin'
                ? { offlineDspAssetRequired: false }
                : { isOfflineDspAssetRequired: () => required.get(optionalId) }),
            executionCapabilities: { requiresWasm: false, owner: 'live' },
            getWasmAssets: () => new Map([[2, { operationRevision: 7 }]])
        }));
    }
    entries.push(plugin('IRReverbPlugin', 99, {
        enabled: false,
        offlineDspAssetRequired: true,
        executionCapabilities: { requiresWasm: false }
    }));
    const waits = [];
    const { audioManager, workletSync } = harness(entries, {
        enabledDspTypes: types,
        dspModuleInfo: { bytes: new ArrayBuffer(8), simd: false },
        waitForAssets: async (entry, slots) => {
            waits.push({ id: entry.id, slots: [...slots] });
            for (const id of required.keys()) required.set(id, false);
            entries.find(candidate => candidate.id === 6).offlineDspAssetRequired = false;
            return {
                ready: true,
                assets: new Map(slots.map(slot => [slot, {
                    payload: new ArrayBuffer(4),
                    operationRevision: 7
                }])),
                revisions: new Map(slots.map(slot => [slot, { operationRevision: 7 }])),
                rejectedCandidates: new Map()
            };
        }
    });
    const result = await buildPipelineAnalyzerSnapshot({
        audioManager,
        workletSync,
        configuration: identityConfiguration,
        resolveRequirements: getPipelineAnalysisRequirements,
        isCurrent: () => true
    });

    assert.deepEqual(waits.map(wait => wait.slots), types.flatMap(() => [[0], [2]]));
    assert.deepEqual(
        result.snapshot.assets.map(asset => [asset.pluginId, asset.slot]),
        types.flatMap((_, index) => [[index + 1, 0], [index + 11, 2]])
    );
    assert.deepEqual(result.snapshot.requiredWasmPluginIds, [1, 2, 3, 4, 5, 6]);
    assert.deepEqual(result.snapshot.dsp.enabledTypes, types);
    for (let index = 0; index < types.length; index += 1) {
        const requiredEntry = entries[index * 2];
        const requiredPayload = result.snapshot.plugins[index * 2];
        const optionalPayload = result.snapshot.plugins[index * 2 + 1];
        assert.equal(requiredEntry.executionCapabilities.requiresWasm, false);
        assert.notEqual(requiredPayload.executionCapabilities, requiredEntry.executionCapabilities);
        assert.equal(requiredPayload.executionCapabilities.requiresWasm, true);
        assert.equal(requiredPayload.executionCapabilities.owner, 'live');
        assert.equal(Object.isFrozen(requiredPayload), true);
        assert.equal(Object.isFrozen(requiredPayload.executionCapabilities), true);
        assert.equal(optionalPayload.executionCapabilities.requiresWasm, false);
    }
    assert.equal(result.snapshot.plugins.at(-1).executionCapabilities.requiresWasm, false);
    assert.equal(result.snapshot.requiredWasmPluginIds.includes(99), false);
});

test('missing required offline asset and unavailable required WASM remain hard failures', async () => {
    const assetEntry = plugin('FiveBandFIRPEQPlugin', 41, {
        offlineDspAssetRequired: true
    });
    const assetHarness = harness([assetEntry], {
        waitForAssets: async () => ({
            ready: false,
            missingSlots: [0],
            timedOut: true
        })
    });
    await assert.rejects(
        buildPipelineAnalyzerSnapshot({
            audioManager: assetHarness.audioManager,
            workletSync: assetHarness.workletSync,
            configuration: identityConfiguration,
            resolveRequirements: getPipelineAnalysisRequirements,
            isCurrent: () => true
        }),
        error => error instanceof PipelineSnapshotError &&
            error.code === 'asset-unavailable' &&
            error.details.timedOut === true &&
            error.details.missingSlots[0] === 0
    );

    const wasmEntry = plugin('UnknownWasmPlugin', 42, {
        executionCapabilities: { requiresWasm: true }
    });
    const wasmHarness = harness([wasmEntry]);
    await assert.rejects(
        buildPipelineAnalyzerSnapshot({
            audioManager: wasmHarness.audioManager,
            workletSync: wasmHarness.workletSync,
            configuration: identityConfiguration,
            resolveRequirements: getPipelineAnalysisRequirements,
            isCurrent: () => true
        }),
        error => error instanceof PipelineSnapshotError && error.code === 'wasm-unavailable'
    );
});

test('missing processor source remains a hard failure for unknown plugin types', async () => {
    const entry = plugin('UnknownPlugin', 51);
    entry.processorString = null;
    const { audioManager, workletSync } = harness([entry]);
    await assert.rejects(
        buildPipelineAnalyzerSnapshot({
            audioManager,
            workletSync,
            configuration: identityConfiguration,
            resolveRequirements: getPipelineAnalysisRequirements,
            isCurrent: () => true
        }),
        error => error instanceof PipelineSnapshotError && error.code === 'processor-unavailable'
    );
});

test('arbitrary four-of-sixteen output routing is preserved without remapping', async () => {
    const { audioManager, workletSync } = harness([], { channelCount: 16 });
    const result = await buildPipelineAnalyzerSnapshot({
        audioManager,
        workletSync,
        configuration: {
            inputChannel: 0,
            slots: [0, 5, 10, 15].map(channel => ({
                enabled: true,
                channel,
                measurementId: null,
                pointId: null
            }))
        },
        resolveRequirements: getPipelineAnalysisRequirements,
        isCurrent: () => true
    });
    assert.deepEqual(result.snapshot.outputChannels, [0, 5, 10, 15]);
});

test('a measurement without a selected point uses the identity speaker response', async () => {
    let irReads = 0;
    const { audioManager, workletSync } = harness([]);
    const result = await buildPipelineAnalyzerSnapshot({
        audioManager,
        workletSync,
        configuration: {
            inputChannel: 0,
            outputs: [{ channel: 0, measurementId: 'room', pointId: null }]
        },
        measurementStore: {
            async getImpulseResponse() {
                irReads += 1;
                return null;
            }
        },
        resolveRequirements: getPipelineAnalysisRequirements,
        isCurrent: () => true
    });

    assert.deepEqual(result.speakerResponses, [null]);
    assert.equal(irReads, 0);
});

test('two-channel snapshots exclude dormant slots from uniqueness, IR loading, and Total', async () => {
    let irReads = 0;
    const { audioManager, workletSync } = harness([], { channelCount: 2 });
    const result = await buildPipelineAnalyzerSnapshot({
        audioManager,
        workletSync,
        configuration: {
            inputChannel: 0,
            slots: [
                { enabled: true, channel: 0, measurementId: null, pointId: null },
                { enabled: true, channel: 1, measurementId: null, pointId: null },
                { enabled: true, channel: 0, measurementId: 'dormant', pointId: 'woofer' },
                { enabled: true, channel: 1, measurementId: 'dormant', pointId: 'tweeter' }
            ]
        },
        measurementStore: {
            async getImpulseResponse() {
                irReads += 1;
                return null;
            }
        },
        resolveRequirements: getPipelineAnalysisRequirements,
        isCurrent: () => true
    });

    assert.deepEqual(result.snapshot.outputChannels, [0, 1]);
    assert.deepEqual(result.speakerResponses, [null, null]);
    assert.equal(irReads, 0);
    const analysis = buildAnalysisResult({
        pipelineResponses: [new Float32Array([1]), new Float32Array([2])],
        speakerResponses: result.speakerResponses,
        outputChannels: result.snapshot.outputChannels,
        sampleRate: 48000
    });
    assert.deepEqual(Array.from(analysis.before.impulse), [1]);
    assert.deepEqual(Array.from(analysis.after.impulse), [3]);
});

test('required WASM IDs include only effective executable plugins that require WASM', async () => {
    const entries = [
        plugin('RequiredWasmPlugin', 21),
        plugin('RequiredWasmPlugin', 22, { enabled: false })
    ];
    const { audioManager, workletSync } = harness(entries, {
        enabledDspTypes: ['RequiredWasmPlugin'],
        dspModuleInfo: { bytes: new ArrayBuffer(8), simd: false }
    });
    const result = await buildPipelineAnalyzerSnapshot({
        audioManager,
        workletSync,
        configuration: identityConfiguration,
        resolveRequirements: () => ({ requiresWasm: true }),
        isCurrent: () => true
    });
    assert.deepEqual(result.snapshot.requiredWasmPluginIds, [21]);
    assert.deepEqual(result.snapshot.dsp.enabledTypes, ['RequiredWasmPlugin']);
});

test('non-cloneable DSP modules are omitted while immutable bytes are copied', async () => {
    const moduleBytes = Uint8Array.from([0, 97, 115, 109, 1, 0, 0, 0]);
    const module = new WebAssembly.Module(moduleBytes);
    const sourceBytes = moduleBytes.buffer.slice(0);
    const entries = [plugin('RequiredWasmPlugin', 31)];
    const { audioManager, workletSync } = harness(entries, {
        enabledDspTypes: ['RequiredWasmPlugin'],
        dspModuleInfo: {
            module,
            moduleCloneable: false,
            bytes: sourceBytes,
            simd: false
        }
    });
    const result = await buildPipelineAnalyzerSnapshot({
        audioManager,
        workletSync,
        configuration: identityConfiguration,
        resolveRequirements: () => ({ requiresWasm: true }),
        isCurrent: () => true
    });

    assert.equal(result.snapshot.dsp.module, null);
    assert.ok(result.snapshot.dsp.bytes instanceof ArrayBuffer);
    assert.notEqual(result.snapshot.dsp.bytes, sourceBytes);
    assert.deepEqual(
        Array.from(new Uint8Array(result.snapshot.dsp.bytes)),
        Array.from(new Uint8Array(sourceBytes))
    );

    audioManager.dspModuleInfo = {
        module,
        moduleCloneable: true,
        bytes: sourceBytes,
        simd: false
    };
    const moduleResult = await buildPipelineAnalyzerSnapshot({
        audioManager,
        workletSync,
        configuration: identityConfiguration,
        resolveRequirements: () => ({ requiresWasm: true }),
        isCurrent: () => true
    });
    assert.equal(moduleResult.snapshot.dsp.module, module);
    assert.equal(moduleResult.snapshot.dsp.bytes, null);
});

test('snapshot freezes canonical measurement settings and participating outputs', async () => {
    const { audioManager, workletSync } = harness([], { channelCount: 4 });
    const measurementSettings = {
        signalType: 'tsp',
        levelDb: -24,
        sequenceLength: 32768,
        stabilizationPeriods: 24,
        averagingPeriods: 4
    };
    const result = await buildPipelineAnalyzerSnapshot({
        audioManager,
        workletSync,
        configuration: {
            inputChannel: 2,
            outputs: [
                {
                    channel: 3,
                    measurementId: null,
                    pointId: null,
                    measurementLabel: 'Woofer',
                    pointLabel: 'Near field'
                },
                { channel: 1, measurementId: null, pointId: null }
            ],
            measurementSettings
        },
        resolveRequirements: getPipelineAnalysisRequirements,
        isCurrent: () => true
    });
    assert.deepEqual(result.snapshot.outputChannels, [3, 1]);
    assert.deepEqual(result.snapshot.measurementSettings, measurementSettings);
    assert.deepEqual(result.provenance.measurementSettings, measurementSettings);
    assert.equal(result.provenance.outputs[0].measurementLabel, 'Woofer');
    assert.equal(result.provenance.outputs[0].pointLabel, 'Near field');
    assert.equal(Object.isFrozen(result.provenance.outputs), true);
    assert.equal(Object.isFrozen(result.provenance.outputs[0]), true);
    assert.equal('slots' in result.provenance, false);
});

test('snapshot includes only proven-active optional WASM preferences and freezes IR support', async () => {
    const optional = plugin('OptionalWasmPlugin', 501, {
        wasmParams: new Float32Array([1]),
        getWasmAssets: () => new Map([[0, {}]])
    });
    const payload = new ArrayBuffer(32 + 20 * Float32Array.BYTES_PER_ELEMENT);
    new DataView(payload).setUint32(8, 20, true);
    const descriptor = { payload, formatTag: 1, rateDivider: 2 };
    const { audioManager, workletSync } = harness([optional], {
        enabledDspTypes: ['OptionalWasmPlugin'],
        dspModuleInfo: { bytes: new ArrayBuffer(8), simd: false },
        waitForAssets: async () => ({
            ready: true,
            assets: new Map([[0, descriptor]]),
            revisions: new Map([[0, { operationRevision: 7 }]]),
            rejectedCandidates: new Map()
        })
    });
    const result = await buildPipelineAnalyzerSnapshot({
        audioManager,
        workletSync,
        configuration: identityConfiguration,
        preferredWasmPluginIds: [501, 999],
        resolveRequirements: getPipelineAnalysisRequirements,
        isCurrent: () => true
    });
    assert.deepEqual(result.snapshot.preferredWasmPluginIds, [501]);
    assert.deepEqual(result.snapshot.preferredWasmTypes, ['OptionalWasmPlugin']);
    assert.deepEqual(result.snapshot.dsp.enabledTypes, ['OptionalWasmPlugin']);
    assert.equal(result.snapshot.assetSupportSamples, 39);
});
