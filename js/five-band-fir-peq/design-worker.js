import {
    designFiveBandFirPeq,
    setFiveBandFirPeqFftBackend
} from './design-core.js';
import { buildIrAssetPayload, IR_ASSET_TOPOLOGY } from '../ir-library/ir-asset-payload.js';
import { createWasmRoomEqFftBackend } from '../room-eq/wasm-fft.js';

const fftBackendPromise = createWasmRoomEqFftBackend()
    .then(backend => {
        setFiveBandFirPeqFftBackend(backend);
        return backend;
    })
    .catch(error => {
        console.warn('5Band FIR PEQ is using the JavaScript FFT fallback:', error);
        return null;
    });

globalThis.onmessage = async event => {
    const request = event.data;
    if (request?.type !== 'design') return;
    try {
        await fftBackendPromise;
        const result = designFiveBandFirPeq(request.config);
        const payload = buildIrAssetPayload({
            channels: result.channels,
            sampleRate: result.config.sampleRate,
            topology: IR_ASSET_TOPOLOGY.mono
        });
        globalThis.postMessage({
            type: 'result',
            requestId: request.requestId,
            payload,
            qualityWarnings: result.qualityWarnings,
            latencyInfo: result.latencyInfo,
            response: result.response
        }, [
            payload,
            result.response.frequencies.buffer,
            result.response.targetDb.buffer,
            result.response.realizedDb.buffer
        ]);
    } catch (error) {
        globalThis.postMessage({
            type: 'error',
            requestId: request.requestId,
            message: error instanceof Error
                ? error.message
                : '5Band FIR PEQ filter design failed.'
        });
    }
};
