import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Worker } from 'node:worker_threads';
import { instantiateDspBinding } from '../../js/audio/dsp-engine-binding.js';
import { prepareSfzAssetForContext, sfzPlayerKind } from '../../js/sfz/preparation-context.js';
import { samplePlayerPreparationData } from '../../js/sfz/effect-cost.js';
import { DSP_PARAM_PACKERS } from '../../js/audio/dsp-params.generated.js';
import { parseSfz } from '../../js/sfz/parser.js';
import { packSfzAsset, packStreamedSfzAsset } from '../../js/sfz/asset.js';
import { createSfzGeneratorSample, isSfzGenerator } from '../../js/sfz/generators.js';
import { prepareSfzOscillatorSources } from '../../js/sfz/oscillator-source.js';

export function createAcceptanceCostWorkerPool() {
    const threads = new Set();
    class CostWorker {
        constructor(url) {
            const entry = new URL(url).href;
            const thread = new Worker(`const { parentPort } = require('node:worker_threads');
                globalThis.WorkerGlobalScope = class { static [Symbol.hasInstance]() { return true; } };
                globalThis.postMessage = (...args) => parentPort.postMessage(...args);
                const pending = [];
                let ready = false;
                parentPort.on('message', data => ready ? globalThis.onmessage({ data }) : pending.push(data));
                import(${JSON.stringify(entry)}).then(() => {
                    ready = true;
                    for (const data of pending) globalThis.onmessage({ data });
                });`, { eval: true });
            threads.add(thread);
            thread.once('exit', () => threads.delete(thread));
            thread.on('message', data => this.onmessage?.({ data }));
            thread.on('error', error => this.onerror?.(error));
            this.thread = thread;
        }
        postMessage(...args) { this.thread.postMessage(...args); }
        terminate() { return this.thread.terminate(); }
    }
    return { Worker: CostWorker, async close() {
        let guard;
        try {
            await Promise.race([
                Promise.all([...threads].map(thread => thread.terminate())),
                new Promise((_, reject) => { guard = setTimeout(() => reject(new Error('Native sizing workers did not close')), 5000); })
            ]);
        } finally { clearTimeout(guard); }
    } };
}

export async function compileAcceptanceInstrument(source, { samples, stream = false, script } = {}) {
    let parsed = await parseSfz({ selectedPath: 'acceptance.sfz', readText: async () => source, onDiagnostic: null });
    assert.deepEqual(parsed.unsupportedOpcodes, []);
    assert.deepEqual(parsed.diagnostics.invalidRegions, []);
    samples ??= new Map([['tone.wav', { sampleRate: 48000, channels: [new Float32Array(4096).fill(.25)] }]]);
    if (!stream) for (const { sample } of parsed.regions)
        if (isSfzGenerator(sample) && !samples.has(sample)) samples.set(sample, createSfzGeneratorSample(sample));
    if (!stream) {
        const residentBytes = [...samples.values()].reduce((sum, pcm) =>
            sum + pcm.channels.reduce((bytes, channel) => bytes + channel.byteLength, 0), 0);
        const prepared = await prepareSfzOscillatorSources(parsed, async path => samples.get(path),
            64 * 1024 * 1024, { residentBytes });
        parsed = prepared.parsed;
        for (const [path, pcm] of prepared.samples) samples.set(path, pcm);
    }
    const options = { modulation: parsed.modulation, effects: parsed.effects, script, ...(stream && { cacheSlots: 8 }) };
    return { ... (stream ? packStreamedSfzAsset : packSfzAsset)(parsed.regions, samples, options), parsed };
}

export async function materializeAcceptanceAsset(binding, asset, { sampleRate = 48000, channels = 2,
    maxFrames = 128, minimumPhysicalBpm = 0, playerKind = 'SoundFontPlayerPlugin' } = {}) {
    return prepareSfzAssetForContext(asset,
        { sampleRate, processingChannels: channels, maxFrames, minimumPhysicalBpm,
            playerKind: sfzPlayerKind(playerKind) },
        64 * 1024 * 1024, (payload, context, formatTag) => {
            const { control, payloadBytes } = samplePlayerPreparationData(payload);
            return binding.estimateSfzEffectPreparation(control, context, formatTag, payloadBytes);
        });
}

export async function openAcceptancePlayer(variant, asset, { channels = 2, sampleRate = 48000, initialize } = {}) {
    const suffix = variant === 'simd' ? '.simd' : '';
    const binding = await instantiateDspBinding(fs.readFileSync(new URL(`../../plugins/dsp/effetune-dsp${suffix}.wasm`, import.meta.url)));
    asset = await materializeAcceptanceAsset(binding, asset, { sampleRate, channels });
    binding.createEngine();
    try {
        assert.equal(binding.prepare(sampleRate, channels, 128, 262144), 0);
        const id = binding.createInstance('SoundFontPlayerPlugin'), packer = DSP_PARAM_PACKERS.get('SoundFontPlayerPlugin');
        const parameters = { mc: 0, pl: 64, og: 0, ...Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`sp${i}`, -1])) };
        assert.equal(binding.instanceSetParams(id, packer.pack(parameters), packer.hash), 0);
        let frame = 0;
        const render = () => {
            const { combined, offsets } = binding.getArenaViews();
            combined.fill(0);
            assert.equal(binding.instanceProcess(id, offsets.combined, channels, 128, frame / sampleRate), 0);
            frame += 128;
            return combined.slice(0, channels * 128);
        };
        assert.equal(binding.instanceSetAsset(id, 0, asset.payload, { ...asset, frames: asset.samples, topology: 0 }), 0);
        await initialize?.(binding, id);
        for (let count = 0; (binding.instanceAssetState(id, 0) & 255) !== 3 && count < 2000; count++) render();
        assert.equal(binding.instanceAssetState(id, 0) & 255, 3, 'New compiled profile must become active');
        assert.equal(binding.instanceSetMidiEvents(id, [], 1, 1), 0);
        assert.equal(binding.instanceSetMidiClock(id, 0, 1, 1), 0);
        frame = 0;
        return { binding, id, render,
            events(events, flags = 0) { assert.equal(binding.instanceSetMidiEvents(id, events, 1, flags), 0); },
            reset({ running = true } = {}) {
                assert.equal(binding.resetInstance(id), 0);
                assert.equal(binding.instanceSetMidiEvents(id, [], 1, 1), 0);
                assert.equal(binding.instanceSetMidiClock(id, 0, 1, running ? 1 : 0), 0); frame = 0;
            },
            close() { binding.destroyEngine(); }
        };
    } catch (error) { binding.destroyEngine(); throw error; }
}

export const midiMessage = (status, data1, data2, offsetFrames = 0, noteId = 0) => ({ status, data1, data2, offsetFrames, noteId });
export const silentBlock = samples => samples.every(value => Math.abs(value) < 1e-7);
