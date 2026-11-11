// Renders measurement signals offline through the effect pipeline snapshot handed over
// from the main app, using the same analysis worker as the Pipeline Analyzer.

const WORKER_URL = new URL('../../../js/pipeline-analyzer/analysis-worker.js', import.meta.url);

// The pipeline snapshot the controller's test signals are rendered through, or null for
// direct playback.
export function activePipelineSnapshot(controller) {
    return controller.measurementConfig?.effectPipeline ? controller.pipelineHandoff?.snapshot ?? null : null;
}

function abortError() {
    return new DOMException('Pipeline render was cancelled', 'AbortError');
}

// Resolves with one Float32Array per pipeline channel, time-aligned with `input` and of
// the same length. Rejects with an AbortError when `signal` aborts.
export async function renderThroughPipeline(snapshot, input, { signal } = {}) {
    if (signal?.aborted) throw abortError();
    if (typeof Worker === 'undefined') {
        if (typeof window !== 'undefined') throw new Error('Web Workers are unavailable');
        const { runRenderRequest } = await import('../../../js/pipeline-analyzer/analysis-worker.js');
        const { output } = await runRenderRequest({ snapshot, input });
        if (signal?.aborted) throw abortError();
        return output;
    }
    const worker = new Worker(WORKER_URL, { type: 'module' });
    try {
        return await new Promise((resolve, reject) => {
            signal?.addEventListener('abort', () => reject(abortError()), { once: true });
            worker.onmessage = ({ data }) => {
                if (data?.type === 'rendered') {
                    resolve(data.output);
                } else if (data?.type === 'error') {
                    reject(new Error(`Pipeline render failed (${data.code}): ${data.message}`));
                }
            };
            worker.onerror = event => {
                event.preventDefault?.();
                reject(new Error(`Pipeline render worker failed: ${event.message || 'unknown error'}`));
            };
            worker.postMessage(
                { type: 'render', requestId: 1, snapshot, input },
                input.map(channel => channel.buffer)
            );
        });
    } finally {
        worker.terminate();
    }
}
