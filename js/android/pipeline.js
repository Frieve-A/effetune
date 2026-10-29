import { DSP_PARAM_PACKERS } from '../audio/dsp-params.generated.js';
import { buildDspPipelineDescriptor } from '../audio/dsp-pipeline-descriptor.js';
import { bytesToBase64 } from './bridge.js';
import { analyzeTemporalCapabilities } from '../audio/power-topology.js';
import { getSerializablePluginStateLong } from '../utils/serialization-utils.js';

export function prepareAndroidPipeline(pipeline, { sampleRate, channelCount = 2, masterBypass = false } = {}) {
    const parameters = new Map(pipeline.map(plugin => [plugin, plugin.getParameters({
        sampleRate, outputChannelCount: channelCount, commitSampleRate: true
    })]));
    const plugins = pipeline.map(plugin => {
        const state = getSerializablePluginStateLong(plugin, true);
        const type = plugin.constructor.name;
        const params = parameters.get(plugin);
        const packer = DSP_PARAM_PACKERS.get(type);
        if (!packer && type !== 'SectionPlugin') throw new Error(`No native DSP parameters for ${type}`);
        return {
            id: plugin.id, name: plugin.name, type, enabled: plugin.enabled,
            parameters: { ...state.parameters, ...params, enabled: plugin.enabled,
                inputBus: state.inputBus ?? null, outputBus: state.outputBus ?? null, channel: state.channel ?? null },
            parameterValues: packer ? Array.from(packer.pack(params)) : [],
            ...(packer?.packBytes ? { parameterBytes: bytesToBase64(packer.packBytes(params)) } : {}),
            layoutHash: packer?.hash ?? 0
        };
    });
    const descriptor = buildDspPipelineDescriptor(pipeline, {
        getInstanceId: plugin => plugin.id,
        getParameters: plugin => parameters.get(plugin)
    });
    const temporal = analyzeTemporalCapabilities(pipeline);
    return { plugins, descriptor: bytesToBase64(descriptor), masterBypass,
        temporalMustProcess: temporal.capabilities.some(item =>
            item.capability === 'must-process' || item.capability === 'age-by-skipped-frames') };
}
