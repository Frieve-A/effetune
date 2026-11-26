/**
 * Both pipelines must exist before a blind test can start; either may be empty.
 */
export function hasDoubleBlindTestPipelines(audioManager) {
    return Array.isArray(audioManager?.pipelineA) && Array.isArray(audioManager?.pipelineB);
}
