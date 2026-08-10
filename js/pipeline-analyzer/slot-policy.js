export const PIPELINE_ANALYZER_MAX_OUTPUT_SLOTS = 4;

export function getPipelineAnalyzerOutputCapacity(channelCount) {
    if (!Number.isInteger(channelCount) || channelCount < 1) return 0;
    return channelCount < PIPELINE_ANALYZER_MAX_OUTPUT_SLOTS
        ? channelCount
        : PIPELINE_ANALYZER_MAX_OUTPUT_SLOTS;
}

export const getPipelineAnalyzerActiveSlotCount = getPipelineAnalyzerOutputCapacity;

export function isPipelineAnalyzerSlotAvailable(index, channelCount) {
    return Number.isInteger(index) && index >= 0 &&
        index < getPipelineAnalyzerOutputCapacity(channelCount);
}
