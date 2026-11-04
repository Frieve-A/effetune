import { parseSmf } from './smf-parser.js';
export { parseSmfAsync } from './smf-parser.js';

if (typeof WorkerGlobalScope !== 'undefined' && globalThis instanceof WorkerGlobalScope) globalThis.onmessage = ({ data }) => {
    try {
        globalThis.postMessage({ result: parseSmf(data.buffer, data.options) });
    } catch (error) {
        globalThis.postMessage({ error: { code: error.code, message: error.message } });
    }
};
