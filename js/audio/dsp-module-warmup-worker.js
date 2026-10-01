import { instantiateDspBinding } from './dsp-engine-binding.js';

self.onmessage = async event => {
    let binding;
    try {
        const { sampleRate } = event.data;
        const module = event.data.module ?? await WebAssembly.compile(event.data.bytes);
        binding = await instantiateDspBinding(module);
        const status = binding.exports.et_rhythm_analyzer_warm_up(sampleRate);
        if (status !== 0) throw new Error(`Rhythm Analyzer warm-up returned ${status}`);
        self.postMessage({ module });
    } catch (error) {
        self.postMessage({ error: error?.message || String(error) });
    } finally {
        binding?.close();
    }
};
