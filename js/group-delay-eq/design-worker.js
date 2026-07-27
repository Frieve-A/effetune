import { designGroupDelayFilter } from './design-core.js';
import { buildIrAssetPayload, IR_ASSET_TOPOLOGY } from '../ir-library/ir-asset-payload.js';

globalThis.onmessage = event => {
    const request = event.data;
    if (request?.type !== 'design') return;
    try {
        const result = designGroupDelayFilter(request.config);
        const payload = buildIrAssetPayload({
            channels: [result.ir],
            sampleRate: Math.round(request.config.sampleRate),
            topology: IR_ASSET_TOPOLOGY.mono
        });
        globalThis.postMessage({
            type: 'result',
            requestId: request.requestId,
            payload,
            bulkDelaySamples: result.bulkDelaySamples,
            clamped: result.clamped,
            limitMs: result.limitMs,
            rippleDb: result.rippleDb,
            response: result.response
        }, [
            payload,
            result.response.frequencies.buffer,
            result.response.targetMs.buffer,
            result.response.realizedMs.buffer
        ]);
    } catch (error) {
        globalThis.postMessage({
            type: 'error',
            requestId: request.requestId,
            message: error instanceof Error ? error.message : 'Group Delay EQ filter design failed.'
        });
    }
};
