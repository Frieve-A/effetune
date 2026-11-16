import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import { instantiateDsp } from '../../js/audio/dsp-wasm-loader.js';
import {
    packSpeakerDistortionCorrectionPluginParams,
    SpeakerDistortionCorrectionPlugin_PARAMS_HASH
} from '../../js/audio/dsp-params.generated.js';
import {
    SPEAKER_DISTORTION_ASSET_BYTES,
    SPEAKER_DISTORTION_ASSET_CHANNELS,
    SPEAKER_DISTORTION_ASSET_FRAMES,
    SPEAKER_DISTORTION_ASSET_MAGIC,
    SPEAKER_DISTORTION_ASSET_TOPOLOGY,
    SPEAKER_DISTORTION_HEADER_BYTES,
    SPEAKER_DISTORTION_ODD_BOUND_FRAME,
    SPEAKER_DISTORTION_ODD_COUNT,
    SPEAKER_DISTORTION_ODD_WEIGHT_FRAME,
    SPEAKER_DISTORTION_STEP,
    SPEAKER_DISTORTION_STEP_FRAME,
    SPEAKER_DISTORTION_WEIGHT_COUNT
} from '../helpers/speaker-distortion-kernel-reference.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ARTIFACTS = {
    baseline: path.join(repoRoot, 'plugins', 'dsp', 'effetune-dsp.wasm'),
    simd: path.join(repoRoot, 'plugins', 'dsp', 'effetune-dsp.simd.wasm')
};
const CHANNELS = 2;
const BLOCK_FRAMES = 128;
const SECONDS = 10;
// Kernel latency; it also proves the asset is active.
const LATENCY = { 48000: { short: 30, long: 120 }, 96000: { short: 60, long: 278 } };
// Same release-budget allowance as the Room EQ kernel gate.
const BUDGET_FACTOR = process.env.GITHUB_ACTIONS === 'true' ? 2 : 1;

/** A Reduce asset for both channels; `odd` also turns on the odd-order block on both (its worst case). */
function assetBytes(length, odd) {
    const bytes = new ArrayBuffer(SPEAKER_DISTORTION_ASSET_BYTES);
    const header = new Uint32Array(bytes, 0, SPEAKER_DISTORTION_HEADER_BYTES / 4);
    header[0] = SPEAKER_DISTORTION_ASSET_MAGIC;
    header[1] = SPEAKER_DISTORTION_ASSET_CHANNELS;
    header[2] = SPEAKER_DISTORTION_ASSET_FRAMES;
    header[4] = SPEAKER_DISTORTION_ASSET_TOPOLOGY;
    const data = new Float32Array(bytes, SPEAKER_DISTORTION_HEADER_BYTES);
    const step = length === 'long' ? SPEAKER_DISTORTION_STEP.LONG : SPEAKER_DISTORTION_STEP.SHORT;
    for (let channel = 0; channel < SPEAKER_DISTORTION_ASSET_CHANNELS; channel++) {
        const base = channel * SPEAKER_DISTORTION_ASSET_FRAMES;
        if (channel < CHANNELS) {
            for (let i = 0; i < SPEAKER_DISTORTION_WEIGHT_COUNT; i++) {
                data[base + i] = (((i * 37 + channel * 11) % 97) - 48) * 1e-4;
            }
            for (let a = 0; a < (odd ? SPEAKER_DISTORTION_ODD_COUNT : 0); a++) {
                data[base + SPEAKER_DISTORTION_ODD_WEIGHT_FRAME + a] = (((a * 13 + channel * 5) % 17) - 8) * 1e-3;
                data[base + SPEAKER_DISTORTION_ODD_BOUND_FRAME + a] = 0.5 + a / 100;
            }
        }
        data[base + SPEAKER_DISTORTION_STEP_FRAME] = step;
    }
    return bytes;
}

function percentile(sorted, ratio) {
    return sorted[Math.ceil(sorted.length * ratio) - 1];
}

async function benchmark(artifact, sampleRate, length, odd) {
    const binding = await instantiateDsp(await fs.readFile(artifact));
    let instanceId = 0;
    try {
        assert.ok(binding.createEngine());
        assert.equal(binding.prepare(sampleRate, CHANNELS, BLOCK_FRAMES, 0), 0);
        instanceId = binding.createInstance('SpeakerDistortionCorrectionPlugin');
        assert.ok(instanceId);
        assert.equal(binding.instanceSetParams(instanceId,
            packSpeakerDistortionCorrectionPluginParams({ dv: 0, md: 'Reduce' }),
            SpeakerDistortionCorrectionPlugin_PARAMS_HASH), 0);
        assert.equal(binding.instanceSetAsset(instanceId, 0, assetBytes(length, odd), {
            headBlock: 0,
            rateDivider: 1,
            pathCount: 0,
            inputCount: 0,
            processingChannels: CHANNELS,
            footprintBytes: SPEAKER_DISTORTION_ASSET_BYTES
        }, 1), 0);

        const arena = binding.getArenaViews();
        const audio = arena.scratch.allChannels.subarray(0, CHANNELS * BLOCK_FRAMES);
        const pointer = binding.pointerForArenaView(audio);
        // A 997 Hz tone at -12 dBFS keeps every section and product busy.
        let phase = 0;
        const increment = 2 * Math.PI * 997 / sampleRate;
        const fill = () => {
            for (let frame = 0; frame < BLOCK_FRAMES; frame++) {
                const value = 0.25 * Math.sin(phase);
                phase += increment;
                audio[frame] = value;
                audio[BLOCK_FRAMES + frame] = -value;
            }
        };
        const blocks = Math.ceil(SECONDS * sampleRate / BLOCK_FRAMES);
        const durations = new Float64Array(blocks);
        const cpuStarted = process.cpuUsage();
        for (let block = 0; block < blocks; block++) {
            fill();
            const started = performance.now();
            assert.equal(binding.instanceProcess(instanceId, pointer, CHANNELS, BLOCK_FRAMES,
                block * BLOCK_FRAMES / sampleRate), 0);
            durations[block] = performance.now() - started;
        }
        const cpu = process.cpuUsage(cpuStarted);
        assert.equal(binding.instanceAssetState(instanceId, 0) & 0xff, 3, 'the asset must be active');
        assert.equal(binding.instanceLatency(instanceId), LATENCY[sampleRate][length]);
        assert.ok(audio.every(Number.isFinite));

        const sorted = Array.from(durations).sort((left, right) => left - right);
        const quantumMs = BLOCK_FRAMES / sampleRate * 1000;
        return {
            cpuRealtimeFactor: (cpu.user + cpu.system) / 1000 / (SECONDS * 1000),
            p95RealtimeFactor: percentile(sorted, 0.95) / quantumMs,
            p99RealtimeFactor: percentile(sorted, 0.99) / quantumMs
        };
    } finally {
        if (instanceId) binding.destroyInstance(instanceId);
        binding.close();
    }
}

test('Distortion Correction stays inside the kernel CPU gate for 10 s of corrected stereo', async () => {
    const results = {};
    for (const [artifactName, artifact] of Object.entries(ARTIFACTS)) {
        for (const sampleRate of [96000, 48000]) {
            for (const length of ['short', 'long']) {
                for (const odd of [false, true]) {
                    const name = `${artifactName} ${sampleRate} Hz ${length}${odd ? ' odd' : ''}`;
                    const result = await benchmark(artifact, sampleRate, length, odd);
                    results[name] = result;
                    assert.ok(result.p95RealtimeFactor < BUDGET_FACTOR,
                        `${name} p95 was ${result.p95RealtimeFactor.toFixed(3)}x real time`);
                    assert.ok(result.p99RealtimeFactor < 2 * BUDGET_FACTOR,
                        `${name} p99 was ${result.p99RealtimeFactor.toFixed(3)}x real time`);
                    assert.ok(result.cpuRealtimeFactor < BUDGET_FACTOR,
                        `${name} used ${result.cpuRealtimeFactor.toFixed(3)}x real time of CPU`);
                }
            }
        }
    }
    console.log('Distortion Correction performance:', JSON.stringify(results));
});
