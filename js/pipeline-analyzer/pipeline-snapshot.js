import { getPipelineAnalyzerActiveSlotCount } from './slot-policy.js';
import { normalizeMeasurementSettings } from './mls.js';
import {
    getPluginExecutionChannelMode,
    getPluginExecutionUnsupportedReason
} from '../audio/plugin-execution-capabilities.js';

export class PipelineSnapshotError extends Error {
    constructor(code, details = {}) {
        super(code);
        this.name = 'PipelineSnapshotError';
        this.code = code;
        this.details = details;
    }
}

export class StalePipelineAnalysisRunError extends Error {
    constructor() {
        super('stale-pipeline-analysis-run');
        this.name = 'StalePipelineAnalysisRunError';
        this.code = 'stale-run';
    }
}

function cloneValue(value, seen = new Map()) {
    if (value === null || typeof value !== 'object') return value;
    if (value instanceof ArrayBuffer) return value.slice(0);
    if (ArrayBuffer.isView(value)) {
        return new value.constructor(value);
    }
    if (seen.has(value)) return seen.get(value);
    if (Array.isArray(value)) {
        const clone = [];
        seen.set(value, clone);
        for (const entry of value) clone.push(cloneValue(entry, seen));
        return clone;
    }
    const clone = {};
    seen.set(value, clone);
    for (const [key, entry] of Object.entries(value)) clone[key] = cloneValue(entry, seen);
    return clone;
}

function guardCurrent(isCurrent) {
    if (typeof isCurrent === 'function' && !isCurrent()) {
        throw new StalePipelineAnalysisRunError();
    }
}

function pluginType(plugin, prepared) {
    return prepared?.type || plugin?.constructor?.name || 'UnknownPlugin';
}

export function getAnalyzerAudioFormat(audioManager) {
    const context = audioManager?.contextManager?.audioContext || audioManager?.audioContext;
    const sampleRate = context?.sampleRate;
    const channelCount = context?.destination?.channelCount;
    if (!(Number.isFinite(sampleRate) && sampleRate > 0) ||
        !Number.isInteger(channelCount) || channelCount < 1 || channelCount > 16) {
        return null;
    }
    return Object.freeze({ sampleRate, channelCount });
}

export function normalizeAnalyzerSlots(configuration, channelCount) {
    const inputChannel = configuration?.inputChannel;
    if (!Number.isInteger(inputChannel) || inputChannel < 0 || inputChannel >= channelCount) {
        throw new PipelineSnapshotError('input-channel-unavailable');
    }
    const usesOutputs = Array.isArray(configuration?.outputs);
    const sourceSlots = usesOutputs
        ? configuration.outputs
        : Array.isArray(configuration?.slots) ? configuration.slots : [];
    const slots = [];
    const selectedChannels = new Set();
    const activeSlotCount = getPipelineAnalyzerActiveSlotCount(channelCount);
    for (let index = 0; index < sourceSlots.length && index < activeSlotCount; index += 1) {
        const source = sourceSlots[index];
        if ((!usesOutputs && source?.enabled !== true) || !Number.isInteger(source.channel) ||
            source.channel < 0 || source.channel >= channelCount) continue;
        if (selectedChannels.has(source.channel)) {
            throw new PipelineSnapshotError('duplicate-output-channel', {
                channel: source.channel
            });
        }
        selectedChannels.add(source.channel);
        const measurementId = typeof source.measurementId === 'string' && source.measurementId
            ? source.measurementId
            : null;
        const pointId = typeof source.pointId === 'string' && source.pointId
            ? source.pointId
            : null;
        slots.push(Object.freeze({
            index,
            enabled: true,
            channel: source.channel,
            measurementId,
            pointId,
            measurementStoreId: source.measurementStoreId ?? measurementId,
            pointStoreId: source.pointStoreId ?? pointId,
            measurementLabel: typeof source.measurementLabel === 'string'
                ? source.measurementLabel
                : null,
            pointLabel: typeof source.pointLabel === 'string' ? source.pointLabel : null
        }));
    }
    if (slots.length === 0) throw new PipelineSnapshotError('output-channel-unavailable');
    return Object.freeze({ inputChannel, slots: Object.freeze(slots) });
}

export function walkEffectivePipeline(preparedEntries, masterBypass) {
    if (masterBypass === true) return [];
    let sectionEnabled = true;
    const effective = [];
    for (const entry of preparedEntries) {
        if (pluginType(entry.plugin, entry.data) === 'SectionPlugin') {
            sectionEnabled = entry.data?.enabled !== false;
            continue;
        }
        if (entry.data?.enabled !== false && sectionEnabled) effective.push(entry);
    }
    return effective;
}

function normalizeRequirements(requirements) {
    const rawSlots = requirements?.requiredAssetSlots ?? [];
    const requiredAssetSlots = [...new Set(
        (Array.isArray(rawSlots) ? rawSlots : [])
            .filter(slot => Number.isInteger(slot) && slot >= 0)
    )];
    return {
        requiresWasm: requirements?.requiresWasm === true,
        requiredAssetSlots,
        warmupSamples: requirements?.warmupSamples
    };
}

function getWarmupSamples(requirements, parameters, sampleRate) {
    const value = typeof requirements.warmupSamples === 'function'
        ? requirements.warmupSamples(parameters, sampleRate)
        : requirements.warmupSamples;
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function requiresOfflineDspAsset(plugin, sampleRate, outputChannelCount) {
    if (typeof plugin?.isOfflineDspAssetRequired === 'function') {
        return plugin.isOfflineDspAssetRequired({ sampleRate, outputChannelCount }) === true;
    }
    return plugin?.offlineDspAssetRequired === true;
}

function requireAnalyzerWasmExecution(prepared) {
    if (prepared?.executionCapabilities?.requiresWasm === true) return prepared;
    const declared = prepared?.executionCapabilities;
    const executionCapabilities = Object.freeze({
        ...(declared && typeof declared === 'object' ? declared : {}),
        requiresWasm: true
    });
    return Object.freeze({
        ...(prepared && typeof prepared === 'object' ? prepared : {}),
        executionCapabilities
    });
}

function copyDspSnapshot(audioManager, requiredTypes, preferredTypes) {
    const moduleInfo = audioManager?.dspModuleInfo;
    const enabledTypes = new Set(audioManager?.getEnabledDspTypes?.() || []);
    const missingTypes = [...requiredTypes].filter(type => !enabledTypes.has(type));
    if (missingTypes.length > 0) {
        throw new PipelineSnapshotError('wasm-unavailable', { pluginTypes: missingTypes });
    }
    const requestedTypes = new Set([...requiredTypes, ...preferredTypes]);
    if (requestedTypes.size === 0) return null;
    if (!moduleInfo) {
        if (requiredTypes.size > 0) {
            throw new PipelineSnapshotError('wasm-unavailable', {
                pluginTypes: [...requiredTypes]
            });
        }
        return null;
    }
    const module = moduleInfo.module && moduleInfo.moduleCloneable !== false
        ? moduleInfo.module
        : null;
    const bytes = !module && moduleInfo.bytes instanceof ArrayBuffer
        ? moduleInfo.bytes.slice(0)
        : null;
    if (!module && !bytes && requiredTypes.size > 0) {
        throw new PipelineSnapshotError('wasm-unavailable', { pluginTypes: [...requiredTypes] });
    }
    if (!module && !bytes) return null;
    return {
        module,
        bytes,
        simd: moduleInfo.simd === true,
        enabledTypes: [...enabledTypes].filter(type => requestedTypes.has(type))
    };
}

function irAssetSupportSamples(descriptor) {
    if (descriptor?.formatTag !== 1 || !(descriptor.payload instanceof ArrayBuffer) ||
        descriptor.payload.byteLength < 12) return 0;
    const frames = new DataView(descriptor.payload).getUint32(8, true);
    const rateDivider = Number.isSafeInteger(descriptor.rateDivider) && descriptor.rateDivider > 0
        ? descriptor.rateDivider
        : 1;
    return frames > 0 ? (frames - 1) * rateDivider : 0;
}

function copyImpulseResponse(record, slot) {
    const data = record?.data;
    const samples = data instanceof Float32Array
        ? new Float32Array(data)
        : ArrayBuffer.isView(data)
            ? new Float32Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength))
            : null;
    if (!samples || samples.length === 0 ||
        !(Number.isFinite(record.sampleRate) && record.sampleRate > 0) ||
        !Number.isSafeInteger(record.onsetIndex) || record.onsetIndex < 0 ||
        record.onsetIndex >= samples.length) {
        throw new PipelineSnapshotError('speaker-ir-unreadable', {
            measurementId: slot.measurementId,
            pointId: slot.pointId
        });
    }
    return {
        channel: slot.channel,
        measurementId: slot.measurementId,
        pointId: slot.pointId,
        measurementLabel: slot.measurementLabel,
        pointLabel: slot.pointLabel,
        data: samples,
        sampleRate: record.sampleRate,
        onsetIndex: record.onsetIndex,
        refScale: Number.isFinite(record.refScale) && record.refScale > 0 ? record.refScale : 1
    };
}

function activePipeline(audioManager) {
    if (typeof audioManager?.getCurrentPipeline === 'function') {
        const pipeline = audioManager.getCurrentPipeline();
        return Array.isArray(pipeline) ? pipeline : [];
    }
    return Array.isArray(audioManager?.pipeline) ? audioManager.pipeline : [];
}

export async function buildPipelineAnalyzerSnapshot(options) {
    const {
        audioManager,
        workletSync,
        configuration,
        measurementStore,
        resolveRequirements,
        isCurrent,
        preferredWasmPluginIds = [],
        assetTimeoutMs = 10000
    } = options || {};
    guardCurrent(isCurrent);
    const format = getAnalyzerAudioFormat(audioManager);
    if (!format) throw new PipelineSnapshotError('audio-configuration-unavailable');
    const selected = normalizeAnalyzerSlots(configuration, format.channelCount);
    const pipelineIdentity = audioManager?.currentPipeline === 'B' ? 'B' : 'A';
    const masterBypass = audioManager?.masterBypass === true;
    const originalEntries = [...activePipeline(audioManager)];
    if (typeof workletSync?.preparePluginData !== 'function') {
        throw new PipelineSnapshotError('pipeline-serialization-unavailable');
    }

    const preparedEntries = originalEntries.map(plugin => ({
        plugin,
        data: cloneValue(workletSync.preparePluginData(plugin))
    }));
    const effectiveEntries = walkEffectivePipeline(preparedEntries, masterBypass);
    const executionEntries = [];
    const requiredWasmTypes = new Set();
    const requiredWasmPluginIds = [];
    const expectedWasmBypassPluginIds = [];
    const expectedWasmBypassReasons = [];
    const preferredIdSet = new Set(
        (Array.isArray(preferredWasmPluginIds) ? preferredWasmPluginIds : [])
            .filter(Number.isInteger)
    );
    const preferredWasmTypes = new Set();
    const frozenPreferredWasmPluginIds = [];
    const enabledDspTypes = new Set(audioManager?.getEnabledDspTypes?.() || []);
    const measurementSettings = normalizeMeasurementSettings(configuration?.measurementSettings);
    let warmupSamples = 0;

    for (const entry of effectiveEntries) {
        const requirements = normalizeRequirements(
            resolveRequirements?.(entry.plugin, entry.data)
        );
        const offlineDspAssetRequired = requiresOfflineDspAsset(
            entry.plugin,
            format.sampleRate,
            format.channelCount
        );
        if (offlineDspAssetRequired) {
            entry.data = requireAnalyzerWasmExecution(entry.data);
        }
        const type = pluginType(entry.plugin, entry.data);
        const requiresWasm = offlineDspAssetRequired || requirements.requiresWasm ||
            entry.data?.executionCapabilities?.requiresWasm === true;
        const unsupportedReason = getPluginExecutionUnsupportedReason(
            {
                ...(entry.data?.executionCapabilities || {}),
                requiresWasm
            },
            {
                sampleRate: format.sampleRate,
                channelMode: getPluginExecutionChannelMode(
                    entry.data?.channel,
                    format.channelCount
                )
            }
        );
        const expectsExecutionBypass = requiresWasm && unsupportedReason !== null;
        if (expectsExecutionBypass) {
            // Announce why the bypass is expected so the analysis accepts that exact reason.
            expectedWasmBypassPluginIds.push(entry.data.id);
            expectedWasmBypassReasons.push({
                pluginId: entry.data.id,
                reason: unsupportedReason
            });
        } else if (requiresWasm) {
            requiredWasmTypes.add(type);
            requiredWasmPluginIds.push(entry.data.id);
        }
        const requiresActiveWasm = requiredWasmPluginIds.includes(entry.data.id);
        if (!requiresActiveWasm && !expectsExecutionBypass && preferredIdSet.has(entry.data.id) &&
            entry.data?.wasmParams instanceof Float32Array && enabledDspTypes.has(type)) {
            preferredWasmTypes.add(type);
            frozenPreferredWasmPluginIds.push(entry.data.id);
        }
        if (measurementSettings.signalType === 'impulse') {
            const declaredWarmup = getWarmupSamples(
                requirements,
                entry.data?.parameters || {},
                format.sampleRate
            );
            if (declaredWarmup > warmupSamples) warmupSamples = declaredWarmup;
        }
        executionEntries.push({
            ...entry,
            requirements,
            type,
            offlineDspAssetRequired
        });
    }

    const processors = [];
    const registeredTypes = new Set();
    for (const entry of executionEntries) {
        if (registeredTypes.has(entry.type)) continue;
        if (typeof entry.plugin?.processorString !== 'string' ||
            typeof entry.plugin?.process !== 'function') {
            throw new PipelineSnapshotError('processor-unavailable', { name: entry.type });
        }
        registeredTypes.add(entry.type);
        processors.push({
            pluginType: entry.type,
            processor: entry.plugin.processorString,
            process: entry.plugin.process.toString()
        });
    }

    const assets = [];
    const assetRevisions = [];
    let assetSupportSamples = 1;
    for (const entry of executionEntries) {
        const desiredSlots = [...(entry.plugin?.getWasmAssets?.().keys?.() || [])];
        const requiredSlots = [...new Set([
            ...entry.requirements.requiredAssetSlots,
            ...(entry.offlineDspAssetRequired ? [0] : []),
            ...desiredSlots
        ])];
        if (requiredSlots.length === 0) continue;
        if (typeof audioManager?.waitForEffectiveActiveWasmAssets !== 'function') {
            throw new PipelineSnapshotError('asset-barrier-unavailable', { name: entry.type });
        }
        const effective = await audioManager.waitForEffectiveActiveWasmAssets(
            entry.plugin,
            requiredSlots,
            { timeoutMs: assetTimeoutMs }
        );
        guardCurrent(isCurrent);
        if (!effective?.ready) {
            throw new PipelineSnapshotError('asset-unavailable', {
                name: entry.type,
                missingSlots: effective?.missingSlots || requiredSlots,
                timedOut: effective?.timedOut === true
            });
        }
        for (const slot of requiredSlots) {
            const descriptor = effective.assets.get(slot);
            const revision = effective.revisions.get(slot);
            assets.push({ pluginId: entry.data.id, slot, ...descriptor });
            assetSupportSamples += irAssetSupportSamples(descriptor);
            assetRevisions.push({
                pluginId: entry.data.id,
                slot,
                operationRevision: revision.operationRevision,
                rejectedCandidate: effective.rejectedCandidates.get(slot) || null
            });
        }
    }

    const speakerResponses = [];
    for (const slot of selected.slots) {
        if (!slot.measurementId || !slot.pointId) {
            speakerResponses.push(null);
            continue;
        }
        if (!measurementStore) {
            throw new PipelineSnapshotError('measurement-store-unavailable', {
                measurementId: slot.measurementId,
                pointId: slot.pointId
            });
        }
        const record = await measurementStore.getImpulseResponse(
            slot.measurementStoreId,
            slot.pointStoreId
        );
        guardCurrent(isCurrent);
        if (!record) {
            throw new PipelineSnapshotError('speaker-ir-missing', {
                measurementId: slot.measurementId,
                pointId: slot.pointId
            });
        }
        speakerResponses.push(copyImpulseResponse(record, slot));
    }

    guardCurrent(isCurrent);
    const outputChannels = selected.slots.map(slot => slot.channel);
    return {
        snapshot: {
            sampleRate: format.sampleRate,
            channelCount: format.channelCount,
            inputChannel: selected.inputChannel,
            outputChannels,
            plugins: preparedEntries.map(entry => entry.data),
            masterBypass,
            processors,
            dsp: copyDspSnapshot(audioManager, requiredWasmTypes, preferredWasmTypes),
            assets,
            requiredWasmPluginIds,
            expectedWasmBypassPluginIds,
            expectedWasmBypassReasons,
            preferredWasmPluginIds: frozenPreferredWasmPluginIds,
            preferredWasmTypes: [...preferredWasmTypes],
            assetSupportSamples,
            measurementSettings,
            warmupSamples: Math.ceil(warmupSamples / 128) * 128
        },
        speakerResponses,
        provenance: {
            pipelineIdentity,
            masterBypass,
            sampleRate: format.sampleRate,
            channelCount: format.channelCount,
            inputChannel: selected.inputChannel,
            outputs: selected.slots,
            measurementSettings,
            assetRevisions
        }
    };
}

export function collectPipelineAnalyzerTransferables(request) {
    const transferables = [];
    const seen = new Set();
    const visit = value => {
        if (!value || typeof value !== 'object') return;
        if (value instanceof ArrayBuffer) {
            if (!seen.has(value)) {
                seen.add(value);
                transferables.push(value);
            }
            return;
        }
        if (ArrayBuffer.isView(value)) {
            visit(value.buffer);
            return;
        }
        if (value instanceof WebAssembly.Module) return;
        if (Array.isArray(value)) {
            for (const entry of value) visit(entry);
            return;
        }
        for (const entry of Object.values(value)) visit(entry);
    };
    visit(request);
    return transferables;
}
