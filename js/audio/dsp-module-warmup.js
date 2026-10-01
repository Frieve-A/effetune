const warmups = new WeakMap();

// A shared WebAssembly.Module shares compiled code, while each instance keeps its own memory.
// Finish cold compilation in a worker before sending the module to any audio worklet.
export function warmUpDspModule(info, sampleRate, {
    workerFactory = () => new Worker(new URL('./dsp-module-warmup-worker.js', import.meta.url), { type: 'module' })
} = {}) {
    let rates = warmups.get(info.module);
    if (!rates) {
        rates = new Map();
        warmups.set(info.module, rates);
    }
    if (rates.has(sampleRate)) return rates.get(sampleRate);
    const promise = new Promise((resolve, reject) => {
        const worker = workerFactory();
        const finish = (error, module) => {
            worker.terminate();
            if (error) reject(error);
            else resolve({ ...info, module, moduleCloneable: true });
        };
        worker.onmessage = event => {
            if (event.data?.error) finish(new Error(event.data.error));
            else finish(null, event.data.module);
        };
        worker.onerror = event => finish(new Error(event.message || 'DSP module warm-up failed'));
        worker.onmessageerror = () => finish(new Error('DSP warm-up module could not be received'));
        try {
            worker.postMessage({
                module: info.moduleCloneable ? info.module : null,
                bytes: info.moduleCloneable ? null : info.bytes,
                sampleRate
            });
        } catch (error) {
            finish(error);
        }
    }).catch(error => {
        rates.delete(sampleRate);
        throw error;
    });
    rates.set(sampleRate, promise);
    return promise;
}
