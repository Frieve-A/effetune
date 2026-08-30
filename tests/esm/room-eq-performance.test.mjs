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
import {
    estimateIrKernelCommitFootprint,
    IR_KERNEL_ASSET_CAPACITY_BYTES
} from '../../js/ir-library/ir-plugin-contract.js';
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
// The release budgets below already allow roughly four times the Windows
// reference-host measurements. GitHub-hosted runners have recently exceeded
// five times those measurements despite unchanged output, so only that
// virtualized environment gets an additional twofold scheduling allowance.
// Local release checks keep the original limits.
const GITHUB_ACTIONS_BUDGET_FACTOR = process.env.GITHUB_ACTIONS === 'true' ? 2 : 1;

function releaseBudget(limit) {
    return limit * GITHUB_ACTIONS_BUDGET_FACTOR;
}

// The reverb path's effective analysis window is clamped by the post-onset data
// that actually exists, so the fixture length decides what the reverb budget
// below measures. `sampleCount` therefore has to be settable; every existing
// caller keeps the 4096-sample default and its fixture bytes are unchanged.
function designSources(channelCount, sampleCount = 4096) {
    return Array.from({ length: channelCount }, (_, channel) => {
        const data = new Float32Array(sampleCount);
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

async function benchmarkConvolver(headBlock, channelCount = CHANNELS, tapCount = TAPS) {
    const binding = await instantiateDsp(await fs.readFile(simdArtifact));
    let instanceId = 0;
    try {
        assert.ok(binding.createEngine());
        assert.equal(binding.prepare(SAMPLE_RATE, channelCount, BLOCK_FRAMES, 0), 0);
        instanceId = binding.createInstance('RoomEqPlugin');
        assert.ok(instanceId);
        assert.equal(binding.instanceSetParams(instanceId, packRoomEqPluginParams({
            lt: String(headBlock),
            fd: 0,
            gn: 0,
            dy: 0
        }), RoomEqPlugin_PARAMS_HASH), 0);

        const taps = new Float32Array(tapCount);
        taps[0] = 0.5;
        taps[4095] = 0.25;
        taps[tapCount - 1] = -0.125;
        const payload = buildIrAssetPayload({
            channels: [taps],
            sampleRate: SAMPLE_RATE,
            topology: IR_ASSET_TOPOLOGY.mono
        });
        const footprintBytes = estimateIrKernelCommitFootprint({
            frames: tapCount,
            assetChannels: 1,
            topology: IR_ASSET_TOPOLOGY.mono,
            processingChannels: channelCount,
            headBlock
        });
        assert.equal(binding.instanceSetAsset(instanceId, 0, payload, {
            channels: 1,
            frames: tapCount,
            topology: IR_ASSET_TOPOLOGY.mono,
            headBlock,
            rateDivider: 1,
            pathCount: 0,
            inputCount: 0,
            processingChannels: channelCount,
            footprintBytes
        }, 1), 0);

        let arena = binding.getArenaViews();
        let audio = arena.scratch.allChannels.subarray(0, channelCount * BLOCK_FRAMES);
        let pointer = binding.pointerForArenaView(audio);
        for (let block = 0; (binding.instanceAssetState(instanceId, 0) & 0xff) === 2 &&
            block < 4096; block += 1) {
            audio.fill(0);
            assert.equal(binding.instanceProcess(
                instanceId,
                pointer,
                channelCount,
                BLOCK_FRAMES,
                block * BLOCK_FRAMES / SAMPLE_RATE
            ), 0);
        }
        assert.equal(binding.instanceAssetState(instanceId, 0) & 0xff, 3);
        assert.equal(binding.resetInstance(instanceId), 0);
        arena = binding.getArenaViews();
        audio = arena.scratch.allChannels.subarray(0, channelCount * BLOCK_FRAMES);
        pointer = binding.pointerForArenaView(audio);
        for (let block = 0; block < 64; block += 1) {
            audio.fill(0.01);
            binding.instanceProcess(instanceId, pointer, channelCount, BLOCK_FRAMES, 0);
        }
        const durations = [];
        for (let block = 0; block < 640; block += 1) {
            audio.fill(0.01);
            const started = performance.now();
            assert.equal(binding.instanceProcess(instanceId, pointer, channelCount, BLOCK_FRAMES, 0), 0);
            durations.push(performance.now() - started);
        }
        durations.sort((left, right) => left - right);
        const quantumMs = BLOCK_FRAMES / SAMPLE_RATE * 1000;
        return {
            worstMs: durations.at(-1),
            p95Ms: percentile(durations, 0.95),
            p99Ms: percentile(durations, 0.99),
            worstRealtimeFactor: durations.at(-1) / quantumMs,
            p95RealtimeFactor: percentile(durations, 0.95) / quantumMs,
            p99RealtimeFactor: percentile(durations, 0.99) / quantumMs
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

        assert.ok(typicalWarmMs < releaseBudget(350),
            `typical warm design used ${typicalWarmMs.toFixed(1)} ms of CPU time`);
        assert.ok(maximumColdMs < releaseBudget(3000),
            `maximum cold design used ${maximumColdMs.toFixed(1)} ms of CPU time`);
        assert.ok(maximumWarmMs < releaseBudget(1000),
            `maximum warm design used ${maximumWarmMs.toFixed(1)} ms of CPU time`);

        clearRoomEqDesignCache();
        const direct = designRoomEq({
            config: designConfig(8192, 6, 'full'),
            sources: designSources(1)
        });
        assert.equal(direct.supportsFullPhase, true);
        assert.equal(direct.channels.length, 1);
        assert.ok(direct.channels[0].every(Number.isFinite));

        // Plan.md section 5 Phase 4 CPU gate: full-phase design with the
        // reverb correction at the release maximum (taps=131072, rv=1 which
        // is UI rv=100, rw=300 ms) joins the cold-design budget series. The
        // synthesis worst case is 7 renders per channel (1 guard baseline +
        // up to 3 guard-ladder scales + up to 3 LFE-ladder scales); this
        // scenario passes the guard at scale 1 with le off, so it renders
        // twice and the ladder scales are not part of the number below.
        //
        // This case needs its own fixture: rw_eff is clamped by the available
        // post-onset window, so on the 4096-sample design fixture it collapses
        // to (4096-128)/96 = 41.33 ms — one seventh of the 300 ms this budget
        // claims to cover, and the extended-window analysis and its consensus
        // are the terms that scale with it. 32768 samples give (32768-128)/96 =
        // 340 ms of window, so the configured 300 ms is what actually runs; the
        // assert below pins that premise. The other budgets keep the 4096-sample
        // fixture unchanged.
        const reverbSources = designSources(1, 32768);
        let reverbDesign = null;
        const reverbColdSamplesMs = [];
        for (let trial = 0; trial < 5; trial += 1) {
            clearRoomEqAnalysisCache();
            clearRoomEqDesignCache();
            reverbColdSamplesMs.push(cpuElapsed(() => {
                reverbDesign = designRoomEq({
                    config: {
                        ...designConfig(TAPS, 6, 'full'),
                        reverbAmount: 1,
                        reverbWindowMs: 300
                    },
                    sources: reverbSources
                });
            }));
        }
        reverbColdSamplesMs.sort((left, right) => left - right);
        const reverbColdMs = percentile(reverbColdSamplesMs, 0.5);
        assert.equal(reverbDesign.diagnostics.reverbCorrection[0].state, 'applied',
            'premise: the reverb correction must engage in the budget scenario');
        assert.equal(reverbDesign.diagnostics.reverbCorrection[0].effectiveWindowMs, 300,
            'premise: the budget must run the configured 300 ms window, not a '
            + 'data-clamped fraction of it');
        assert.ok(reverbDesign.channels[0].every(Number.isFinite),
            'reverb-corrected taps must stay finite');
        // Runner-calibrated budget (plan.md section 5 Phase 4): Node v22.23.2
        // measured a 391 ms median (469 ms maximum) on the Windows reference host
        // and a 621 ms median (880 ms maximum) on a slow GitHub Linux worker. The
        // 1500 ms limit keeps roughly the same fourfold reference-host headroom as
        // the established typical-design gate and 70 % headroom over the slowest
        // observed worker sample. Use the median of five cold-cache trials so JIT
        // and garbage-collection noise cannot make the gate flaky.
        assert.ok(reverbColdMs < releaseBudget(1500),
            `reverb cold-design median used ${reverbColdMs.toFixed(1)} ms of CPU time `
            + `(samples: ${reverbColdSamplesMs.map(value => value.toFixed(1)).join(', ')})`);

        const latencyZero = await benchmarkConvolver(0);
        const latency128 = await benchmarkConvolver(128);
        for (const [name, result] of [['lt=0', latencyZero], ['lt=128', latency128]]) {
            assert.ok(result.p95RealtimeFactor < releaseBudget(1),
                `${name} p95 was ${result.p95RealtimeFactor.toFixed(2)}x real time`);
            assert.ok(result.p99RealtimeFactor < releaseBudget(2),
                `${name} p99 was ${result.p99RealtimeFactor.toFixed(2)}x real time`);
        }
        console.log('Room EQ performance:', JSON.stringify({
            typicalWarmMs,
            maximumColdMs,
            maximumWarmMs,
            reverbColdMs,
            reverbColdSamplesMs,
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

test('Room EQ 8-channel independent IR assets stay inside the kernel capacity', () => {
    // plan.md section 2.6 T-11: the largest Room EQ asset the UI can request is
    // 8 channels of 131072 taps published as one independent payload. It has to
    // commit inside the 32 MiB kernel capacity with the head block engaged.
    const independent = estimateIrKernelCommitFootprint({
        frames: TAPS,
        assetChannels: 8,
        topology: IR_ASSET_TOPOLOGY.independent,
        processingChannels: 8,
        headBlock: 128
    });
    assert.equal(independent, 24040880);
    assert.ok(independent < IR_KERNEL_ASSET_CAPACITY_BYTES,
        `8-channel independent commit needs ${independent} bytes`);
    assert.ok(estimateIrKernelCommitFootprint({
        frames: TAPS,
        assetChannels: 8,
        topology: IR_ASSET_TOPOLOGY.independent,
        processingChannels: 8,
        headBlock: 0
    }) < IR_KERNEL_ASSET_CAPACITY_BYTES);
});

test('Room EQ 16-channel design and 65536-tap convolution stay inside release budgets', async () => {
    const backend = new WasmRoomEqFftBackend(await instantiateDsp(await fs.readFile(baselineArtifact)));
    setRoomEqFftBackend(backend);
    try {
        const designMedians = {};
        for (const channels of [8, 16]) {
            const sources = designSources(channels);
            const samples = [];
            for (let trial = 0; trial < 3; trial++) {
                clearRoomEqAnalysisCache();
                clearRoomEqDesignCache();
                let result;
                samples.push(cpuElapsed(() => { result = designRoomEq({ config: designConfig(65536), sources }); }));
                assert.equal(result.channels.length, channels);
                assert.ok(result.channels.every(channel => channel.length === 65536 && channel.every(Number.isFinite)));
            }
            samples.sort((a, b) => a - b);
            designMedians[channels] = percentile(samples, 0.5);
        }
        // Node v24.13.0 on the Windows reference host measured an 8-channel
        // cold median of 437 ms. Doubling for 16 channels with the established
        // fourfold reference-host headroom gives 3496 ms, rounded to 3500 ms.
        // The measured 16-channel median was 1281 ms; old budgets are unchanged.
        assert.ok(designMedians[16] < releaseBudget(3500),
            `16-channel cold-design median used ${designMedians[16].toFixed(1)} ms of CPU time`);
        const latencyZero = await benchmarkConvolver(0, 16, 65536);
        const latency128 = await benchmarkConvolver(128, 16, 65536);
        for (const result of [latencyZero, latency128]) {
            assert.ok(result.p95RealtimeFactor < releaseBudget(1), `16-channel p95 was ${result.p95RealtimeFactor.toFixed(2)}x real time`);
            assert.ok(result.p99RealtimeFactor < releaseBudget(2), `16-channel p99 was ${result.p99RealtimeFactor.toFixed(2)}x real time`);
        }
        console.log('Room EQ 16-channel performance:', JSON.stringify({ designMedians, latencyZero, latency128 }));
    } finally {
        setRoomEqFftBackend(null);
        backend.close();
        clearRoomEqAnalysisCache();
        clearRoomEqDesignCache();
    }
});

test('Room EQ 16-channel independent IR fits at 65536 taps but not at 131072', () => {
    for (const headBlock of [0, 128]) {
        const footprint = frames => estimateIrKernelCommitFootprint({ frames, assetChannels: 16,
            topology: IR_ASSET_TOPOLOGY.independent, processingChannels: 16, headBlock });
        assert.ok(footprint(65536) < IR_KERNEL_ASSET_CAPACITY_BYTES);
        assert.ok(footprint(131072) > IR_KERNEL_ASSET_CAPACITY_BYTES);
    }
});
