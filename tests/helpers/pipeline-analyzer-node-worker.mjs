import { parentPort } from 'node:worker_threads';

import { installAnalysisWorker } from '../../js/pipeline-analyzer/analysis-worker.js';

if (!parentPort) throw new Error('Pipeline Analyzer test helper requires a parent port');

const scope = {
    onmessage: null,
    postMessage(message, transferList = []) {
        parentPort.postMessage(message, transferList);
    }
};

installAnalysisWorker(scope);
parentPort.on('message', data => scope.onmessage?.({ data }));
