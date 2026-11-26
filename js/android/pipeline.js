import { buildDspPipelineNodes, DSP_PIPELINE_MAX_NODES, encodeDspPipelineDescriptor } from '../audio/dsp-pipeline-descriptor.js';
import { bytesToBase64 } from './bridge.js';
import { analyzeTemporalCapabilities } from '../audio/power-topology.js';
import { getPluginExecutionCapabilities } from '../audio/plugin-execution-capabilities.js';
import { getSerializablePluginStateLong } from '../utils/serialization-utils.js';
import { fitsNativeInstanceLimit, isDisplayOnly, noteAnalysisSources, packed } from '../native/engine-endpoint.js';

// Transient keyboard-preview keys that getWorkletPluginData adds. On Android the Service holds them
// (pipeline.preview) and overlays them when packing, so they never enter the canonical pipeline.
export const ANDROID_PREVIEW_KEYS = new Map([
    ['SFZNotePlayerPlugin', ['pm', 'pv']],
    ['SoundFontPlayerPlugin', ['pm', 'pc']]
]);

function pipelineLimitError() {
    return Object.assign(new RangeError('Android effect limit exceeded'), { code: 'pipeline-too-large' });
}

export function prepareAndroidPipeline(pipeline, { sampleRate, channelCount = 2, masterBypass = false } = {}) {
    if (pipeline.length > DSP_PIPELINE_MAX_NODES) throw pipelineLimitError();
    // DSP-facing parameters, as the worklet and the desktop native engine receive them, without preview state.
    const parameters = new Map(pipeline.map(plugin => {
        const params = plugin.getParameters({ sampleRate, outputChannelCount: channelCount, commitSampleRate: true });
        const dspParams = { ...(plugin.getWorkletPluginData?.(params).parameters ?? params) };
        for (const key of ANDROID_PREVIEW_KEYS.get(plugin.constructor.name) ?? []) delete dspParams[key];
        return [plugin, dspParams];
    }));
    const nodes = buildDspPipelineNodes(pipeline, {
        getInstanceId: plugin => plugin.id,
        getParameters: plugin => parameters.get(plugin)
    });
    // Desktop configure rules: an effect that cannot run here is skipped with a reason, and display-only
    // effects may pass audio through while hidden unless an SFZ Note Player consumes their analysis.
    const active = [];
    let nodeIndex = 0;
    const plugins = pipeline.map(plugin => {
        const state = getSerializablePluginStateLong(plugin, true);
        const type = plugin.constructor.name;
        const params = parameters.get(plugin);
        const record = {
            id: plugin.id, name: plugin.name, type, enabled: plugin.enabled,
            parameters: { ...state.parameters, ...params, enabled: plugin.enabled,
                inputBus: state.inputBus ?? null, outputBus: state.outputBus ?? null, channel: state.channel ?? null }
        };
        if (type === 'SectionPlugin') return { ...record, parameterValues: [], layoutHash: 0 };
        const item = packed({ id: plugin.id, type, parameters: params, channel: state.channel ?? null,
            executionCapabilities: getPluginExecutionCapabilities(plugin) }, sampleRate, channelCount);
        const node = nodes[nodeIndex++];
        if (node.enabled && node.sectionGate) active.push({ id: plugin.id, type, parameters: params, ...node, skip: item.skip });
        return { ...record, parameterValues: Array.from(item.floats),
            ...(item.bytes ? { parameterBytes: bytesToBase64(item.bytes) } : {}),
            layoutHash: item.layoutHash, skip: item.skip, reason: item.reason,
            displayOnly: isDisplayOnly({ type, parameters: params }) };
    });
    const producers = new Set(noteAnalysisSources(masterBypass ? [] : active).values());
    for (const record of plugins) if (producers.has(record.id)) record.displayOnly = false;
    if (!fitsNativeInstanceLimit(plugins)) throw pipelineLimitError();
    const descriptor = encodeDspPipelineDescriptor(nodes);
    const temporal = analyzeTemporalCapabilities(pipeline);
    // The Service applies a chain only to an engine running at the rate it was packed for.
    return { plugins, descriptor: bytesToBase64(descriptor), masterBypass, sampleRate,
        temporalMustProcess: temporal.capabilities.some(item =>
            item.capability === 'must-process' || item.capability === 'age-by-skipped-frames') };
}
