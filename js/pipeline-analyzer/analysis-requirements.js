const DEFAULT_REQUIREMENTS = Object.freeze({
    requiresWasm: false,
    requiredAssetSlots: Object.freeze([]),
    warmupSamples: 0
});

// These processors need an initialization quantum or fade interval after a context
// reset. Unit Impulse discards it so reset behavior does not become part of the IR.
const RESET_FADE_WARMUP = Object.freeze({
    ChannelDividerPlugin: 128,
    FIRCrossoverPlugin: 128,
    FiveBandFIRPEQPlugin: 128,
    GroupDelayEqPlugin: 128,
    MultibandBalancePlugin: 128,
    MultibandCompressorPlugin: 128,
    MultibandExpanderPlugin: (_parameters, sampleRate) => Math.ceil(sampleRate * 0.005),
    MultibandSaturationPlugin: 128,
    MultibandTransientPlugin: 128,
    RoomEqPlugin: 128
});

export function getPipelineAnalysisRequirements(plugin, preparedData = null) {
    const type = preparedData?.type || plugin?.constructor?.name;
    const warmupSamples = RESET_FADE_WARMUP[type] || 0;
    const requiresWasm = preparedData?.executionCapabilities?.requiresWasm === true;
    if (!requiresWasm && warmupSamples === 0) {
        return DEFAULT_REQUIREMENTS;
    }
    return {
        ...DEFAULT_REQUIREMENTS,
        requiresWasm,
        warmupSamples
    };
}
