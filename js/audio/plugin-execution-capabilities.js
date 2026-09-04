const STANDARD_DSP_SAMPLE_RATES = Object.freeze([
    44100,
    48000,
    88200,
    96000,
    176400,
    192000
]);

const STANDARD_WASM_EXECUTION_CAPABILITIES = Object.freeze({
    requiresWasm: true,
    supportedSampleRates: STANDARD_DSP_SAMPLE_RATES
});

const UNBOUNDED_WASM_EXECUTION_CAPABILITIES = Object.freeze({
    requiresWasm: true
});

// Existing reference-DSP source files keep their frozen parity hashes. New plugins
// declare capabilities on their class instead of extending this compatibility table.
const EXECUTION_CAPABILITIES_BY_PLUGIN_TYPE = new Map([
    ['AMRadioSimulatorPlugin', UNBOUNDED_WASM_EXECUTION_CAPABILITIES],
    ['FIRCrossoverPlugin', STANDARD_WASM_EXECUTION_CAPABILITIES],
    ['FiveBandFIRPEQPlugin', STANDARD_WASM_EXECUTION_CAPABILITIES],
    ['GroupDelayEqPlugin', STANDARD_WASM_EXECUTION_CAPABILITIES],
    ['RoomEqPlugin', STANDARD_WASM_EXECUTION_CAPABILITIES],
    ['SWRadioSimulatorPlugin', STANDARD_WASM_EXECUTION_CAPABILITIES]
]);

export function getPluginExecutionCapabilities(plugin) {
    const declared = plugin?.constructor?.executionCapabilities ??
        plugin?.executionCapabilities;
    if (declared && typeof declared === 'object') return declared;
    return EXECUTION_CAPABILITIES_BY_PLUGIN_TYPE.get(plugin?.constructor?.name) ?? null;
}

export function getPluginExecutionChannelMode(channel, outputChannelCount) {
    if (!Number.isInteger(outputChannelCount) || outputChannelCount < 1) return null;
    let mode;
    let firstChannel;
    let requiredChannels;
    switch (channel) {
        case 'A':
            mode = 'all';
            firstChannel = 0;
            requiredChannels = outputChannelCount;
            break;
        case 'L':
            mode = 'single';
            firstChannel = 0;
            requiredChannels = 1;
            break;
        case 'R':
            mode = 'single';
            firstChannel = 1;
            requiredChannels = 1;
            break;
        case null:
        case undefined:
            mode = outputChannelCount === 1 ? 'mono' : 'stereo-pair';
            firstChannel = 0;
            requiredChannels = outputChannelCount === 1 ? 1 : 2;
            break;
        case '34':
        case '56':
        case '78':
            mode = 'stereo-pair';
            firstChannel = Number(channel[0]) - 1;
            requiredChannels = 2;
            break;
        case '910':
        case '1112':
        case '1314':
        case '1516':
            mode = 'stereo-pair';
            firstChannel = Number(channel.slice(0, channel.length / 2)) - 1;
            requiredChannels = 2;
            break;
        default: {
            const parsedChannel = Number.parseInt(channel, 10);
            if (!Number.isInteger(parsedChannel) || parsedChannel <= 0) return null;
            mode = 'single';
            firstChannel = parsedChannel - 1;
            requiredChannels = 1;
            break;
        }
    }
    return firstChannel + requiredChannels <= outputChannelCount ? mode : null;
}

export function getPluginExecutionUnsupportedReason(pluginOrCapabilities, {
    sampleRate,
    channelMode
} = {}) {
    const capabilities = pluginOrCapabilities?.requiresWasm !== undefined ||
        pluginOrCapabilities?.supportedSampleRates !== undefined ||
        pluginOrCapabilities?.supportedChannelModes !== undefined
        ? pluginOrCapabilities
        : getPluginExecutionCapabilities(pluginOrCapabilities);
    if (!capabilities || typeof capabilities !== 'object') return null;
    if (Array.isArray(capabilities.supportedSampleRates) &&
        !capabilities.supportedSampleRates.includes(sampleRate)) {
        return 'unsupportedSampleRate';
    }
    if (Array.isArray(capabilities.supportedChannelModes) &&
        !capabilities.supportedChannelModes.includes(channelMode)) {
        return 'unsupportedChannelMode';
    }
    return null;
}

export function attachPluginExecutionCapabilities(plugin, payload) {
    const capabilities = getPluginExecutionCapabilities(plugin);
    if (capabilities && payload && typeof payload === 'object') {
        payload.executionCapabilities = capabilities;
    }
    return payload;
}
