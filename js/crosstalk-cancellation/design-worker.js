import { designCrosstalkCancellation } from './design-core.js';
import {
    buildIrAssetPayload,
    IR_ASSET_TOPOLOGY
} from '../ir-library/ir-asset-payload.js';

globalThis.onmessage = event => {
    const request = event.data;
    if (request?.type !== 'design') return;
    try {
        const result = designCrosstalkCancellation(request);
        const payload = buildIrAssetPayload({
            channels: result.channels,
            sampleRate: result.config.sampleRate,
            topology: IR_ASSET_TOPOLOGY.trueStereo
        });
        globalThis.postMessage({
            type: 'result',
            requestId: request.requestId,
            payload,
            config: result.config,
            diagnostics: result.diagnostics
        }, [payload]);
    } catch (error) {
        globalThis.postMessage({
            type: 'error',
            requestId: request.requestId,
            code: typeof error?.code === 'string' ? error.code : 'design-failed',
            message: error instanceof Error
                ? error.message
                : 'The crosstalk filter could not be designed.'
        });
    }
};
