import { parseScoreData } from './score-file.js';

if (typeof WorkerGlobalScope !== 'undefined' && globalThis instanceof WorkerGlobalScope) globalThis.onmessage = async ({ data }) => {
    try {
        globalThis.postMessage({ result: await parseScoreData(data.buffer, data.options) });
    } catch (error) {
        globalThis.postMessage({ error: { code: error.code ?? 'musicxml-corrupt', message: error.message } });
    }
};
