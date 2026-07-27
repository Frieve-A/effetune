import {
    designFIRCrossover,
    setFIRCrossoverFftBackend
} from './design-core.js';
import { buildIrAssetPayload, IR_ASSET_TOPOLOGY } from '../ir-library/ir-asset-payload.js';
import { createWasmRoomEqFftBackend } from '../room-eq/wasm-fft.js';

const fftBackendPromise = createWasmRoomEqFftBackend()
    .then(backend => {
        setFIRCrossoverFftBackend(backend);
        return backend;
    })
    .catch(error => {
        console.warn('FIR Crossover is using the JavaScript FFT fallback:', error);
        return null;
    });

globalThis.onmessage = async event => {
    const request = event.data;
    if (request?.type !== 'design') return;
    try {
        await fftBackendPromise;
        const result = designFIRCrossover(request.config);
        const paths = result.channels.flatMap((_, band) => [
            { inputSlot: 0, outputSlot: band * 2, irChannel: band },
            { inputSlot: 1, outputSlot: band * 2 + 1, irChannel: band }
        ]);
        const payload = buildIrAssetPayload({
            channels: result.channels,
            sampleRate: result.config.sampleRate,
            topology: IR_ASSET_TOPOLOGY.matrix,
            paths
        });
        globalThis.postMessage({
            type: 'result',
            requestId: request.requestId,
            payload,
            bandCount: result.config.bandCount,
            latencyInfo: result.latencyInfo
        }, [payload]);
    } catch (error) {
        globalThis.postMessage({
            type: 'error',
            requestId: request.requestId,
            message: error instanceof Error
                ? error.message
                : 'FIR Crossover filter design failed.'
        });
    }
};
