import { designRoomEq, setRoomEqFftBackend } from './design-core.js';
import { buildIrAssetPayload, IR_ASSET_TOPOLOGY } from '../ir-library/ir-asset-payload.js';
import { createWasmRoomEqFftBackend } from './wasm-fft.js';

const fftBackendPromise = createWasmRoomEqFftBackend()
    .then(backend => {
        setRoomEqFftBackend(backend);
        return backend;
    })
    .catch(error => {
        console.warn('Room EQ is using the JavaScript FFT fallback:', error);
        return null;
    });

globalThis.onmessage = async event => {
    const request = event.data;
    if (request?.type !== 'design') return;
    try {
        await fftBackendPromise;
        const result = designRoomEq(request);
        const payload = buildIrAssetPayload({
            channels: result.channels,
            sampleRate: result.config.sampleRate,
            topology: IR_ASSET_TOPOLOGY.mono
        });
        const transferables = [payload];
        for (const preview of result.previews) {
            if (!preview) continue;
            transferables.push(
                preview.frequencies.buffer,
                preview.measuredDb.buffer,
                preview.targetDb.buffer,
                preview.predictedDb.buffer,
                preview.baseCorrectionDb.buffer
            );
            if (preview.impulseResponse) {
                transferables.push(
                    preview.impulseResponse.before.buffer,
                    preview.impulseResponse.after.buffer
                );
            }
        }
        globalThis.postMessage({
            type: 'result',
            requestId: request.requestId,
            payload,
            previews: result.previews,
            qualityWarnings: result.qualityWarnings,
            supportsFullPhase: result.supportsFullPhase,
            latencyInfo: result.latencyInfo
        }, transferables);
    } catch (error) {
        globalThis.postMessage({
            type: 'error',
            requestId: request.requestId,
            message: error instanceof Error ? error.message : 'Room EQ filter design failed.'
        });
    }
};
