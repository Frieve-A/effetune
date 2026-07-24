import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import { instantiateDsp } from '../../js/audio/dsp-wasm-loader.js';
import {
    clearRoomEqAnalysisCache,
    clearRoomEqDesignCache,
    designRoomEq,
    setRoomEqFftBackend
} from '../../js/room-eq/design-core.js';
import { WasmRoomEqFftBackend } from '../../js/room-eq/wasm-fft.js';
import { buildIrAssetPayload, IR_ASSET_TOPOLOGY } from '../../js/ir-library/ir-asset-payload.js';
import { estimateIrKernelCommitFootprint } from '../../js/ir-library/ir-plugin-contract.js';
import {
    packRoomEqPluginParams,
    RoomEqPlugin_PARAMS_HASH
} from '../../js/audio/dsp-params.generated.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const baselineArtifact = path.join(repoRoot, 'plugins', 'dsp', 'effetune-dsp.wasm');
const simdArtifact = path.join(repoRoot, 'plugins', 'dsp', 'effetune-dsp.simd.wasm');
const SAMPLE_RATE = 96000;
const CHANNELS = 8;
const TAPS = 131072;
const BLOCK_FRAMES = 128;

function designSources(channelCount) {
    return Array.from({ length: channelCount }, (_, channel) => {
        const data = new Float32Array(4096);
        data[128] = 1;
        data[173 + channel] = 0.1 + channel * 0.01;
        const id = `room-eq-performance-${channel}`;
        return {
            measurement: {
                id,
                timestamp: 'fixed',
                points: [{ pointId: 1, timestamp: 'fixed' }],
                averageFrequencyResponse: []
            },
            impulses: [{
                measurementId: id,
                pointId: 1,
                sampleRate: SAMPLE_RATE,
                onsetIndex: 128,
                refScale: 1,
                data
            }]
        };
    });
}

function designConfig(taps, maxBoostDb = 6, phase = 'lin') {
    return {
        sampleRate: SAMPLE_RATE,
        taps,
        phase,
        smoothing: 0.17,
        lowFrequency: 20,
        highFrequency: 16000,
        directWindowMs: 6,
        maxBoostDb,
        referencePoint: 1,
        eqBands: []
    };
}

function cpuElapsed(action) {
    const started = process.cpuUsage();
    action();
    const usage = process.cpuUsage(started);
    return (usage.user + usage.system) / 1000;
}

function percentile(sorted, ratio) {
    return sorted[Math.ceil(sorted.length * ratio) - 1];
}

async function benchmarkConvolver(headBlock) {
    const binding = await instantiateDsp(await fs.readFile(simdArtifact));
    let instanceId = 0;
    try {
        assert.ok(binding.createEngine());
        assert.equal(binding.prepare(SAMPLE_RATE, CHANNELS, BLOCK_FRAMES, 0), 0);
        instanceId = binding.createInstance('RoomEqPlugin');
        assert.ok(instanceId);
        assert.equal(binding.instanceSetParams(instanceId, packRoomEqPluginParams({
            lt: String(headBlock),
            fd: 0,
            gn: 0,
            dy: 0
        }), RoomEqPlugin_PARAMS_HASH), 0);

        const taps = new Float32Array(TAPS);
        taps[0] = 0.5;
        taps[4095] = 0.25;
        taps[TAPS - 1] = -0.125;
        const payload = buildIrAssetPayload({
            channels: [taps],
            sampleRate: SAMPLE_RATE,
            topology: IR_ASSET_TOPOLOGY.mono
        });
        const footprintBytes = estimateIrKernelCommitFootprint({
            frames: TAPS,
            assetChannels: 1,
            topology: IR_ASSET_TOPOLOGY.mono,
            processingChannels: CHANNELS,
            headBlock
        });
        assert.equal(binding.instanceSetAsset(instanceId, 0, payload, {
            channels: 1,
            frames: TAPS,
            topology: IR_ASSET_TOPOLOGY.mono,
            headBlock,
            rateDivider: 1,
            pathCount: 0,
            inputCount: 0,
            processingChannels: CHANNELS,
            footprintBytes
        }, 1), 0);

        let arena = binding.getArenaViews();
        let audio = arena.scratch.allChannels.subarray(0, CHANNELS * BLOCK_FRAMES);
        let pointer = binding.pointerForArenaView(audio);
        for (let block = 0; (binding.instanceAssetState(instanceId, 0) & 0xff) === 2 &&
            block < 4096; block += 1) {
            audio.fill(0);
            assert.equal(binding.instanceProcess(
                instanceId,
                pointer,
                CHANNELS,
                BLOCK_FRAMES,
                block * BLOCK_FRAMES / SAMPLE_RATE
            ), 0);
        }
        assert.equal(binding.instanceAssetState(instanceId, 0) & 0xff, 3);
        assert.equal(binding.resetInstance(instanceId), 0);
        arena = binding.getArenaViews();
        audio = arena.scratch.allChannels.subarray(0, CHANNELS * BLOCK_FRAMES);
        pointer = binding.pointerForArenaView(audio);
        for (let block = 0; block < 64; block += 1) {
            audio.fill(0.01);
            binding.instanceProcess(instanceId, pointer, CHANNELS, BLOCK_FRAMES, 0);
        }
        const durations = [];
        for (let block = 0; block < 640; block += 1) {
            audio.fill(0.01);
            const started = performance.now();
            assert.equal(binding.instanceProcess(instanceId, pointer, CHANNELS, BLOCK_FRAMES, 0), 0);
            durations.push(performance.now() - started);
        }
        durations.sort((left, right) => left - right);
        const quantumMs = BLOCK_FRAMES / SAMPLE_RATE * 1000;
        return {
            worstMs: durations.at(-1),
            p95Ms: percentile(durations, 0.95),
            worstRealtimeFactor: durations.at(-1) / quantumMs,
            p95RealtimeFactor: percentile(durations, 0.95) / quantumMs
        };
    } finally {
        if (instanceId) binding.destroyInstance(instanceId);
        binding.close();
    }
}

test('Room EQ PFFFT design and final-4096 convolution stay inside release budgets', async () => {
    const backend = new WasmRoomEqFftBackend(await instantiateDsp(await fs.readFile(baselineArtifact)));
    setRoomEqFftBackend(backend);
    try {
        const typicalSources = designSources(1);
        clearRoomEqAnalysisCache();
        clearRoomEqDesignCache();
        designRoomEq({ config: designConfig(32768), sources: typicalSources });
        clearRoomEqDesignCache();
        const typicalWarmMs = cpuElapsed(() => designRoomEq({
            config: designConfig(32768, 6.1),
            sources: typicalSources
        }));

        const maximumSources = designSources(1);
        clearRoomEqAnalysisCache();
        clearRoomEqDesignCache();
        const maximumColdMs = cpuElapsed(() => designRoomEq({
            config: designConfig(TAPS),
            sources: maximumSources
        }));
        clearRoomEqDesignCache();
        const maximumWarmMs = cpuElapsed(() => designRoomEq({
            config: designConfig(TAPS, 6.1),
            sources: maximumSources
        }));

        assert.ok(typicalWarmMs < 150,
            `typical warm design used ${typicalWarmMs.toFixed(1)} ms of CPU time`);
        assert.ok(maximumColdMs < 3000,
            `maximum cold design used ${maximumColdMs.toFixed(1)} ms of CPU time`);
        assert.ok(maximumWarmMs < 1000,
            `maximum warm design used ${maximumWarmMs.toFixed(1)} ms of CPU time`);

        clearRoomEqDesignCache();
        const direct = designRoomEq({
            config: designConfig(8192, 6, 'full'),
            sources: designSources(1)
        });
        assert.equal(direct.supportsFullPhase, true);
        assert.equal(direct.channels.length, 1);
        assert.ok(direct.channels[0].every(Number.isFinite));

        const latencyZero = await benchmarkConvolver(0);
        const latency128 = await benchmarkConvolver(128);
        for (const [name, result] of [['lt=0', latencyZero], ['lt=128', latency128]]) {
            assert.ok(result.p95RealtimeFactor < 1,
                `${name} p95 was ${result.p95RealtimeFactor.toFixed(2)}x real time`);
            assert.ok(result.worstRealtimeFactor < 2,
                `${name} worst quantum was ${result.worstRealtimeFactor.toFixed(2)}x real time`);
        }
        console.log('Room EQ performance:', JSON.stringify({
            typicalWarmMs,
            maximumColdMs,
            maximumWarmMs,
            latencyZero,
            latency128
        }));
    } finally {
        setRoomEqFftBackend(null);
        backend.close();
        clearRoomEqAnalysisCache();
        clearRoomEqDesignCache();
    }
});
