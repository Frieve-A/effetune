/** Both pipelines must contain an effect before a blind test can start. */
export function hasDoubleBlindTestPipelines(audioManager) {
    const a = audioManager?.pipelineA;
    const b = audioManager?.pipelineB;
    return Array.isArray(a) && a.length > 0 && Array.isArray(b) && b.length > 0;
}
