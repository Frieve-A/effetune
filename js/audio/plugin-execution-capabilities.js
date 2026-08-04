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

export function attachPluginExecutionCapabilities(plugin, payload) {
    const capabilities = getPluginExecutionCapabilities(plugin);
    if (capabilities && payload && typeof payload === 'object') {
        payload.executionCapabilities = capabilities;
    }
    return payload;
}
