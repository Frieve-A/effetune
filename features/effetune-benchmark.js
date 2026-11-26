import { buildDspPipelineDescriptor } from '../js/audio/dsp-pipeline-descriptor.js';
import { bytesToBase64, getAndroidBridge, isAndroidHost } from '../js/android/bridge.js';
import '../plugins/multires-spectrum.js';
import {
    getPluginExecutionCapabilities,
    getPluginExecutionChannelMode,
    getPluginExecutionUnsupportedReason
} from '../js/audio/plugin-execution-capabilities.js';
import { getDspRolloutConfig } from '../js/audio/dsp-rollout.js';
import { DSP_PARAM_PACKERS } from '../js/audio/dsp-params.generated.js';
import { instantiateDsp, loadDspModule } from '../js/audio/dsp-wasm-loader.js';
import { connectAudioEngine, NativeControlClient } from '../js/native/engine-connection.js';
import { packed, packRecords } from '../js/native/engine-endpoint.js';
import {
    buildIrAssetPayload,
    IR_ASSET_FORMAT_TAG,
    IR_ASSET_TOPOLOGY
} from '../js/ir-library/ir-asset-payload.js';
import {
    estimateIrKernelCommitFootprint,
    resolveIrProcessingConfig
} from '../js/ir-library/ir-plugin-contract.js';
import { openSf2Source } from '../js/sf2/source.js';
import { sf2SamplerRegions } from '../js/sf2/asset.js';
import { packStreamedSfzAsset } from '../js/sfz/asset.js';
import { samplePlayerPreparationData } from '../js/sfz/effect-cost.js';
import { SFZ_DEFAULT_MAX_BYTES } from '../js/sfz/limits.js';
import { materializeSfzAsset, sfzPlayerKind } from '../js/sfz/preparation-context.js';

export const BENCHMARK_DSP_MODES = Object.freeze({
    JAVASCRIPT: 'javascript',
    WEBASSEMBLY: 'webassembly',
    NATIVE: 'native'
});

export const BENCHMARK_DSP_MAX_CHANNELS = 16;
export const BENCHMARK_DSP_TELEMETRY_BYTES = 256 * 1024;
export const BENCHMARK_DSP_TELEMETRY_RATE = 60;
export const BENCHMARK_IR_REVERB_FRAMES = 256 * 1024;
export const BENCHMARK_IR_REVERB_NOTE =
    'True Stereo; deterministic 4-channel IR, 256K samples/channel ' +
    '(IR load/preparation excluded from timing)';
export const SOUNDFONT_BENCHMARK_VOICES = 64;
export const SOUNDFONT_BENCHMARK_NOTE =
    `Temporary dummy SoundFont; ${SOUNDFONT_BENCHMARK_VOICES} sustained voices ` +
    '(SoundFont load excluded from timing)';
export const BANDWIDTH_EXTENDER_BENCHMARK_CUTOFF_HZ = 16000;
export const BANDWIDTH_EXTENDER_BENCHMARK_NOTE =
    'Manual 16 kHz cutoff; deterministic band-limited input; four FFT frames of warmup';

const FIR_BENCHMARK_ASSET_SLOT = 0;
const FIR_BENCHMARK_LATENCY = '128';
const FIR_BENCHMARK_CROSSOVER_CHANNELS = 4;
const FIR_BENCHMARK_TAIL_CYCLES = 4;
const FIR_BENCHMARK_WORKLOADS = new Map([
    ['FIR Crossover', Object.freeze({
        channelCount: FIR_BENCHMARK_CROSSOVER_CHANNELS,
        parameters: Object.freeze({
            bc: 2,
            f1: 2000,
            s1: -96,
            pm: 'min',
            tp: 32768,
            lt: FIR_BENCHMARK_LATENCY
        }),
        seed: 0x46495243,
        note: '2 bands / 4ch; deterministic 32K-tap matrix FIR; tail-stage warmup'
    })],
    ['5Band FIR PEQ', Object.freeze({
        channelCount: 2,
        parameters: Object.freeze({
            g0: 1,
            g1: -1,
            g2: 1,
            g3: -1,
            g4: 1,
            pm: 'min',
            tp: 32768,
            lt: FIR_BENCHMARK_LATENCY
        }),
        seed: 0x35464952,
        note: 'All 5 bands active; deterministic 32K-tap mono FIR; tail-stage warmup'
    })],
    ['Group Delay EQ', Object.freeze({
        channelCount: 2,
        parameters: Object.freeze({
            d8: 1,
            tp: 16384,
            lt: FIR_BENCHMARK_LATENCY
        }),
        seed: 0x47444551,
        note: '1 kHz band +1 ms; deterministic 16K-tap mono FIR; delay/tail-stage warmup'
    })],
    ['Group Delay PEQ', Object.freeze({
        channelCount: 2,
        parameters: Object.freeze({
            d2: 1,
            tp: 16384,
            lt: FIR_BENCHMARK_LATENCY
        }),
        seed: 0x47445051,
        note: '1 kHz band +1 ms; deterministic 16K-tap mono FIR; delay/tail-stage warmup'
    })]
]);

const DSP_OK = 0;
const DSP_ASSET_STATE_PREPARING = 2;
const DSP_ASSET_STATE_ACTIVE = 3;
// Matches the batch size of the native benchmark loop.
const NATIVE_BENCHMARK_MIN_WARMUP_BLOCKS = 1024;
const NATIVE_BENCHMARK_ASSET_TIMEOUT_MS = 2000;
const NATIVE_BENCHMARK_FAILURE_NOTES = {
    setup: 'Native DSP could not start processing this effect',
    asset: 'Native DSP could not load this effect’s audio data',
    processing: 'Native DSP stopped processing this effect'
};
const IR_REVERB_ASSET_SLOT = 0;
const IR_REVERB_CHANNELS = 4;
const SOUNDFONT_ASSET_SLOT = 0;
const SOUNDFONT_BENCHMARK_SAMPLE_FRAMES = 4096;
const SOUNDFONT_BENCHMARK_SAMPLE_CYCLES = 32;
const SOUNDFONT_STREAM_GENERATION = 1;
const SOUNDFONT_MIDI_GENERATION = 1;
const SOUNDFONT_NOTE_ON = 0x90;
const SOUNDFONT_NOTE_VELOCITY = 100;
// Long enough that every note stays held for the whole native measurement.
const SOUNDFONT_TIMELINE_SECONDS = 3600;

export class DspBenchmarkUnavailableError extends Error {
    constructor(message) {
        super(message);
        this.name = 'DspBenchmarkUnavailableError';
    }
}

export class DspBenchmarkPluginUnavailableError extends Error {
    constructor(typeName, reason) {
        super(reason
            ? `${typeName}: ${reason}`
            : `${typeName} is not enabled for WebAssembly DSP benchmarking`);
        this.name = 'DspBenchmarkPluginUnavailableError';
        this.typeName = typeName;
    }
}

function defaultWarning(message) {
    globalThis.console?.warn?.(message);
}

function assertStatus(status, operation) {
    if (status !== DSP_OK) {
        throw new Error(`${operation} failed with status ${status}`);
    }
}

function requirePositiveInteger(value, label, maximum = Number.MAX_SAFE_INTEGER) {
    if (!Number.isInteger(value) || value < 1 || value > maximum) {
        throw new RangeError(`${label} must be an integer from 1 to ${maximum}`);
    }
    return value;
}

function bandwidthExtenderFftSize(sampleRate) {
    if (sampleRate <= 50000) return 1024;
    if (sampleRate <= 100000) return 2048;
    return 4096;
}

function benchmarkFirHeadBlock(latency) {
    const headBlock = Number(latency);
    if (![0, 128, 256, 512, 1024].includes(headBlock)) {
        throw new RangeError('FIR benchmark latency is invalid');
    }
    return headBlock;
}

function createDeterministicFirChannel(frames, seed, directFrame = 0, directGain = 1) {
    if (!Number.isInteger(directFrame) || directFrame < 0 || directFrame >= frames) {
        throw new RangeError('FIR benchmark direct frame is invalid');
    }
    const impulseResponse = new Float32Array(frames);
    let state = seed >>> 0;
    let envelope = 0.001;
    for (let frame = 0; frame < impulseResponse.length; frame++) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        impulseResponse[frame] = ((state / 0x100000000) * 2 - 1) * envelope;
        envelope *= 0.9998;
    }
    impulseResponse[directFrame] = directGain;
    return impulseResponse;
}

function createBenchmarkFirAsset({
    channels,
    sampleRate,
    topology,
    paths,
    processingChannels,
    latency
}) {
    const headBlock = benchmarkFirHeadBlock(latency);
    const pathCount = paths?.length ?? 0;
    const inputCount = paths
        ? new Set(paths.map(path => path.inputSlot)).size
        : 0;
    const payload = buildIrAssetPayload({ channels, sampleRate, topology, paths });
    const footprintBytes = estimateIrKernelCommitFootprint({
        frames: channels[0].length,
        assetChannels: channels.length,
        topology,
        processingChannels,
        headBlock,
        pathCount,
        inputCount
    });
    return new Map([[FIR_BENCHMARK_ASSET_SLOT, {
        payload,
        formatTag: IR_ASSET_FORMAT_TAG,
        headBlock,
        rateDivider: 1,
        pathCount,
        inputCount,
        processingChannels,
        footprintBytes
    }]]);
}

export function createMonoFirBenchmarkAssets({
    sampleRate,
    channelCount = 2,
    taps,
    latency = FIR_BENCHMARK_LATENCY,
    seed = 0x6d2b79f5,
    directFrame = 0
}) {
    requirePositiveInteger(sampleRate, 'sampleRate');
    const frames = requirePositiveInteger(taps, 'FIR benchmark taps', 131072);
    const processingChannels = requirePositiveInteger(
        channelCount,
        'channelCount',
        BENCHMARK_DSP_MAX_CHANNELS
    );
    return createBenchmarkFirAsset({
        channels: [createDeterministicFirChannel(frames, seed, directFrame)],
        sampleRate,
        topology: IR_ASSET_TOPOLOGY.mono,
        processingChannels,
        latency
    });
}

export function createFirCrossoverBenchmarkAssets({
    sampleRate,
    channelCount = FIR_BENCHMARK_CROSSOVER_CHANNELS,
    bandCount = 2,
    taps = 32768,
    latency = FIR_BENCHMARK_LATENCY,
    seed = 0x46495243
}) {
    requirePositiveInteger(sampleRate, 'sampleRate');
    const frames = requirePositiveInteger(taps, 'FIR Crossover benchmark taps', 131072);
    const bands = requirePositiveInteger(bandCount, 'FIR Crossover benchmark bands', 4);
    const processingChannels = requirePositiveInteger(
        channelCount,
        'channelCount',
        BENCHMARK_DSP_MAX_CHANNELS
    );
    if (processingChannels !== bands * 2) {
        throw new RangeError('FIR Crossover benchmark requires two output channels per band');
    }
    const channels = Array.from({ length: bands }, (_, band) =>
        createDeterministicFirChannel(frames, seed + band * 0x9e3779b9, 0, 1 / bands));
    const paths = channels.flatMap((_, band) => [
        { inputSlot: 0, outputSlot: band * 2, irChannel: band },
        { inputSlot: 1, outputSlot: band * 2 + 1, irChannel: band }
    ]);
    return createBenchmarkFirAsset({
        channels,
        sampleRate,
        topology: IR_ASSET_TOPOLOGY.matrix,
        paths,
        processingChannels,
        latency
    });
}

function firConvolverMaximumBlock(taps, processingChannels, headBlock) {
    let maximum = taps <= 8192
        ? 512
        : taps <= 65535
            ? 1024
            : 2048;
    if (taps > 131071 && processingChannels <= 2) maximum = 4096;
    const latencyMinimum = 2 * (headBlock || 128);
    return maximum < latencyMinimum ? latencyMinimum : maximum;
}

export function getFirBenchmarkWarmupFrames({
    taps,
    latency = FIR_BENCHMARK_LATENCY,
    filterDelaySamples = 0,
    processingChannels = 2,
    blockSize = 128
}) {
    const frames = requirePositiveInteger(taps, 'FIR benchmark taps', 131072);
    const channels = requirePositiveInteger(
        processingChannels,
        'processingChannels',
        BENCHMARK_DSP_MAX_CHANNELS
    );
    const block = requirePositiveInteger(blockSize, 'blockSize');
    if (!Number.isInteger(filterDelaySamples) || filterDelaySamples < 0 ||
        filterDelaySamples >= frames) {
        throw new RangeError('FIR benchmark filter delay is invalid');
    }
    const headBlock = benchmarkFirHeadBlock(latency);
    const maximumBlock = firConvolverMaximumBlock(frames, channels, headBlock);
    const warmupFrames = filterDelaySamples + FIR_BENCHMARK_TAIL_CYCLES * maximumBlock;
    return Math.ceil(warmupFrames / block) * block;
}

function applyFixedBenchmarkParameters(plugin, parameters) {
    for (const [key, value] of Object.entries(parameters)) {
        if (!Object.hasOwn(plugin, key)) {
            throw new TypeError(`FIR benchmark plugin does not expose parameter ${key}`);
        }
        plugin[key] = value;
    }
}

export function configureFirBenchmarkWorkload({
    plugin,
    sampleRate,
    blockSize = 128,
    usesWasm = false
}) {
    const definition = FIR_BENCHMARK_WORKLOADS.get(plugin?.name);
    if (!definition) return null;
    requirePositiveInteger(sampleRate, 'sampleRate');
    requirePositiveInteger(blockSize, 'blockSize');

    const base = {
        channelCount: definition.channelCount,
        assets: new Map(),
        warmupFrames: blockSize,
        note: definition.note,
        requiresWasmAssets: true
    };
    if (!usesWasm) return base;
    if (typeof plugin.getParameters !== 'function') {
        throw new TypeError('FIR benchmark plugin does not implement the parameter contract');
    }

    // The benchmark supplies the FIR asset itself. Calling setParameters() here would
    // schedule a second asynchronous filter design and contaminate the timed run.
    applyFixedBenchmarkParameters(plugin, definition.parameters);
    const parameters = plugin.getParameters({
        sampleRate,
        outputChannelCount: definition.channelCount
    });
    const taps = requirePositiveInteger(parameters.tp, 'FIR benchmark taps', 131072);
    const filterDelaySamples = Number(parameters.fd) || 0;
    const assets = plugin.name === 'FIR Crossover'
        ? createFirCrossoverBenchmarkAssets({
            sampleRate,
            channelCount: definition.channelCount,
            bandCount: parameters.bc,
            taps,
            latency: parameters.lt,
            seed: definition.seed
        })
        : createMonoFirBenchmarkAssets({
            sampleRate,
            channelCount: definition.channelCount,
            taps,
            latency: parameters.lt,
            seed: definition.seed,
            directFrame: filterDelaySamples
        });
    return {
        ...base,
        assets,
        warmupFrames: getFirBenchmarkWarmupFrames({
            taps,
            latency: parameters.lt,
            filterDelaySamples,
            processingChannels: definition.channelCount,
            blockSize
        })
    };
}

export function createBandwidthExtenderBenchmarkInput({
    sampleRate,
    duration,
    channelCount = 2,
    blockSize = 128
}) {
    requirePositiveInteger(sampleRate, 'sampleRate');
    requirePositiveInteger(channelCount, 'channelCount', BENCHMARK_DSP_MAX_CHANNELS);
    requirePositiveInteger(blockSize, 'blockSize');
    if (!Number.isFinite(duration) || duration <= 0) {
        throw new RangeError('duration must be a positive finite number');
    }

    const blockCount = Math.ceil(sampleRate * duration / blockSize);
    const input = new Float32Array(blockCount * blockSize * channelCount);
    const frequencies = [997, 4013, 7993, 12011, 14983];
    for (let block = 0; block < blockCount; block++) {
        const blockOffset = block * blockSize * channelCount;
        for (let channel = 0; channel < channelCount; channel++) {
            const channelOffset = blockOffset + channel * blockSize;
            const phaseOffset = channel * 0.37;
            for (let localFrame = 0; localFrame < blockSize; localFrame++) {
                const frame = block * blockSize + localFrame;
                const time = frame / sampleRate;
                let sample = 0;
                for (let tone = 0; tone < frequencies.length; tone++) {
                    sample += Math.sin(
                        2 * Math.PI * frequencies[tone] * time + phaseOffset * (tone + 1)
                    );
                }
                input[channelOffset + localFrame] = sample * 0.12;
            }
        }
    }
    return input;
}

export function getBandwidthExtenderBenchmarkWarmupFrames(sampleRate) {
    requirePositiveInteger(sampleRate, 'sampleRate');
    return bandwidthExtenderFftSize(sampleRate) * 4;
}

function getPluginType(plugin) {
    const typeName = plugin?.constructor?.name;
    if (!typeName || typeName === 'Object') {
        throw new TypeError('Benchmark plugin must expose its registered constructor name');
    }
    return typeName;
}

function getBenchmarkFormatUnsupportedReason(plugin, sampleRate, channelCount) {
    const channelMode = getPluginExecutionChannelMode(
        channelCount > 2 ? 'A' : (plugin?.channel ?? null),
        channelCount
    );
    const reason = getPluginExecutionUnsupportedReason(plugin, { sampleRate, channelMode });
    if (reason === 'unsupportedSampleRate') {
        const rates = getPluginExecutionCapabilities(plugin).supportedSampleRates
            .map(rate => `${rate / 1000} kHz`).join(' / ');
        return `supports only ${rates}; select a supported sampling frequency to measure this effect`;
    }
    return reason === 'unsupportedChannelMode'
        ? 'this channel configuration is not supported'
        : null;
}

function preparePlugin(plugin, sampleRate, blockSize, channelCount) {
    if (!plugin || typeof plugin.getParameters !== 'function' ||
        typeof plugin.setEnabled !== 'function') {
        throw new TypeError('Benchmark plugin does not implement the plugin runtime contract');
    }
    plugin.setEnabled(true);
    return {
        ...plugin.getParameters(),
        channelCount,
        blockSize,
        sampleRate
    };
}

function createDeterministicTrueStereoIr() {
    const channels = Array.from(
        { length: IR_REVERB_CHANNELS },
        () => new Float32Array(BENCHMARK_IR_REVERB_FRAMES)
    );
    const seeds = [0x12345678, 0x9abcdef0, 0x31415926, 0x27182818];
    for (let channel = 0; channel < channels.length; channel++) {
        const samples = channels[channel];
        let state = seeds[channel];
        let envelope = 0.02;
        for (let frame = 1; frame < samples.length; frame++) {
            state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
            samples[frame] = ((state / 0x100000000) * 2 - 1) * envelope;
            envelope *= 0.99995;
        }
    }
    channels[0][0] = 1;
    channels[1][0] = 0.25;
    channels[2][0] = 0.25;
    channels[3][0] = 1;
    return channels;
}

export function createIrReverbBenchmarkAssets({
    sampleRate,
    channelCount = 2,
    latency = '128',
    convolutionRate = 'auto'
}) {
    const config = resolveIrProcessingConfig({
        sampleRate,
        channelCount: IR_REVERB_CHANNELS,
        engineChannels: channelCount,
        selectedChannels: channelCount,
        topologyHint: 'true-stereo',
        channelMode: 'true',
        latency,
        convolutionRate
    });
    if (!config.valid) {
        throw new Error(`IR Reverb benchmark configuration is invalid: ${config.message}`);
    }

    const payload = buildIrAssetPayload({
        channels: createDeterministicTrueStereoIr(),
        sampleRate: config.sampleRate,
        topology: IR_ASSET_TOPOLOGY.trueStereo
    });
    const footprintBytes = estimateIrKernelCommitFootprint({
        frames: BENCHMARK_IR_REVERB_FRAMES,
        assetChannels: config.assetChannels,
        topology: config.topology,
        processingChannels: config.processingChannels,
        headBlock: config.headBlock,
        pathCount: config.pathCount,
        inputCount: config.inputCount
    });
    return new Map([[IR_REVERB_ASSET_SLOT, {
        payload,
        formatTag: IR_ASSET_FORMAT_TAG,
        headBlock: config.headBlock,
        rateDivider: config.rateDivider,
        pathCount: config.pathCount,
        inputCount: config.inputCount,
        processingChannels: config.processingChannels,
        footprintBytes
    }]]);
}

function riffChunk(name, data) {
    const bytes = new Uint8Array(8 + data.length + (data.length & 1));
    for (let index = 0; index < 4; index++) bytes[index] = name.charCodeAt(index);
    new DataView(bytes.buffer).setUint32(4, data.length, true);
    bytes.set(data, 8);
    return bytes;
}

function riffList(type, children) {
    const totalBytes = children.reduce((sum, child) => sum + child.length, 4);
    const data = new Uint8Array(totalBytes);
    for (let index = 0; index < 4; index++) data[index] = type.charCodeAt(index);
    let offset = 4;
    for (const child of children) {
        data.set(child, offset);
        offset += child.length;
    }
    return data;
}

function littleEndianRecords(byteLength, write) {
    const bytes = new Uint8Array(byteLength);
    write(new DataView(bytes.buffer), bytes);
    return bytes;
}

function writeAscii(bytes, offset, text) {
    for (let index = 0; index < text.length; index++) bytes[offset + index] = text.charCodeAt(index);
}

// One preset, one full-range instrument zone and one looped sine sample.
function createDummySoundFont() {
    const frames = SOUNDFONT_BENCHMARK_SAMPLE_FRAMES;
    const pcm = new Float32Array(frames);
    const smpl = littleEndianRecords((frames + 46) * 2, view => {
        for (let frame = 0; frame < frames; frame++) {
            const value = Math.round(8192 * Math.sin(2 * Math.PI * SOUNDFONT_BENCHMARK_SAMPLE_CYCLES * frame / frames));
            pcm[frame] = value / 32768;
            view.setInt16(frame * 2, value, true);
        }
    });
    const generators = pairs => littleEndianRecords(pairs.length * 4, view => pairs.forEach(([operator, amount], index) => {
        view.setUint16(index * 4, operator, true);
        view.setUint16(index * 4 + 2, amount, true);
    }));
    const tables = [
        ['phdr', littleEndianRecords(38 * 2, (view, bytes) => {
            writeAscii(bytes, 0, 'Benchmark');
            view.setUint16(38 + 24, 1, true);
        })],
        ['pbag', generators([[0, 0], [1, 0]])],
        ['pmod', new Uint8Array(10)],
        ['pgen', generators([[41, 0], [0, 0]])],
        ['inst', littleEndianRecords(22 * 2, (view, bytes) => {
            writeAscii(bytes, 0, 'Benchmark');
            view.setUint16(22 + 20, 1, true);
        })],
        ['ibag', generators([[0, 0], [3, 0]])],
        ['imod', new Uint8Array(10)],
        ['igen', generators([[43, 127 << 8], [54, 1], [53, 0], [0, 0]])],
        ['shdr', littleEndianRecords(46 * 2, (view, bytes) => {
            writeAscii(bytes, 0, 'Sine');
            view.setUint32(24, frames, true);
            view.setUint32(32, frames, true);
            view.setUint32(36, 48000, true);
            bytes[40] = 60;
            view.setUint16(44, 1, true);
        })]
    ];
    const bytes = riffChunk('RIFF', riffList('sfbk', [
        riffChunk('LIST', riffList('INFO', [
            riffChunk('ifil', new Uint8Array([2, 0, 4, 0])),
            riffChunk('INAM', littleEndianRecords(10, (view, nameBytes) => writeAscii(nameBytes, 0, 'Benchmark')))
        ])),
        riffChunk('LIST', riffList('sdta', [riffChunk('smpl', smpl)])),
        riffChunk('LIST', riffList('pdta', tables.map(([name, data]) => riffChunk(name, data))))
    ]));
    return { bytes, pcm };
}

async function estimateSoundFontPreparation(asset, context, { controlBinding, basePath, warning }) {
    let binding = controlBinding;
    if (!binding) {
        const moduleInfo = await loadDspModule({ basePath, warning });
        if (!moduleInfo) throw new DspBenchmarkUnavailableError('WebAssembly DSP could not be loaded');
        binding = await instantiateDsp(moduleInfo.module || moduleInfo.bytes, { warning });
    }
    try {
        return await materializeSfzAsset(asset, context, SFZ_DEFAULT_MAX_BYTES, (payload, prepared, formatTag) => {
            const { control, payloadBytes } = samplePlayerPreparationData(payload);
            return binding.estimateSfzEffectPreparation(control, prepared, formatTag, payloadBytes);
        });
    } finally {
        if (binding !== controlBinding) binding.close();
    }
}

// The bank load and page publishing are setup work; timing covers sustained voice rendering only.
export async function createSoundFontBenchmarkAssets({
    sampleRate,
    channelCount = 2,
    blockSize,
    basePath = '..',
    controlBinding = null,
    warning = defaultWarning
}) {
    const { bytes, pcm } = createDummySoundFont();
    const source = await openSf2Source({
        size: bytes.byteLength,
        revision: 'benchmark',
        readRange: async (offset, length) => bytes.subarray(offset, offset + length)
    });
    const samples = new Map(source.samples.map(sample => [sample.path, {
        frames: sample.frames, channels: 1, sampleRate: sample.sampleRate, revision: '0'.repeat(64)
    }]));
    const packed = packStreamedSfzAsset(sf2SamplerRegions(source), samples, {
        cacheSlots: 8,
        sourceProfile: source.compiled.sourceProfile,
        presets: source.compiled.presets,
        modulation: source.compiled
    });
    const asset = await estimateSoundFontPreparation(packed, {
        sampleRate,
        processingChannels: channelCount,
        maxFrames: blockSize,
        minimumPhysicalBpm: 0,
        playerKind: sfzPlayerKind('SoundFontPlayerPlugin')
    }, { controlBinding, basePath, warning });
    const firstKey = 64 - SOUNDFONT_BENCHMARK_VOICES / 2;
    return new Map([[SOUNDFONT_ASSET_SLOT, {
        payload: asset.payload,
        formatTag: asset.formatTag,
        headBlock: asset.headBlock,
        rateDivider: asset.rateDivider,
        processingChannels: asset.processingChannels,
        footprintBytes: asset.footprintBytes,
        preparationContext: asset.preparationContext,
        soundFont: {
            frames: asset.samples,
            pages: [{ sample: 0, pageIndex: 0, pcm, frames: pcm.length, channels: 1 }],
            notes: Array.from({ length: SOUNDFONT_BENCHMARK_VOICES }, (_, index) => firstKey + index)
        }
    }]]);
}

export function createRoomEqBenchmarkAssets({
    sampleRate,
    channelCount = 2,
    taps,
    latency = '128'
}) {
    return createMonoFirBenchmarkAssets({
        sampleRate,
        channelCount,
        taps,
        latency,
        seed: 0x6d2b79f5
    });
}

class JavascriptBenchmarkSession {
    constructor(plugin, { sampleRate, blockSize, channelCount }) {
        if (typeof plugin?.executeProcessor !== 'function') {
            throw new TypeError('Benchmark plugin does not expose executeProcessor');
        }
        this.plugin = plugin;
        this.parameters = preparePlugin(plugin, sampleRate, blockSize, channelCount);
        this.context = { sampleRate, initialized: false };
        const type = getPluginType(plugin);
        if (type === 'SpectrumAnalyzerPlugin' || type === 'SpectrogramPlugin') {
            globalThis.MultiresSpectrum.prepare(this.context, sampleRate, type === 'SpectrumAnalyzerPlugin' ? 4 : 5);
        }
        this.closed = false;
    }

    process(inputData, timeSeconds) {
        if (this.closed) throw new Error('JavaScript benchmark session is closed');
        this.context.multiresSpectrum?.release(this.context.multiresFrame);
        return this.plugin.executeProcessor(
            this.context,
            inputData,
            this.parameters,
            timeSeconds
        );
    }

    prepareAssets() {
        return 0;
    }

    close() {
        this.closed = true;
    }
}

class JavascriptBenchmarkRuntime {
    constructor(sampleRate, blockSize) {
        this.sampleRate = sampleRate;
        this.blockSize = blockSize;
        this.label = 'JavaScript';
        this.variant = BENCHMARK_DSP_MODES.JAVASCRIPT;
        this.usesWasm = false;
        this.supportsAssets = false;
        this.closed = false;
    }

    getPluginUnsupportedReason(plugin, { channelCount = 2 } = {}) {
        if (getPluginExecutionCapabilities(plugin)?.requiresWasm === true) {
            return 'requires WebAssembly DSP';
        }
        return getBenchmarkFormatUnsupportedReason(plugin, this.sampleRate, channelCount);
    }

    supportsPlugin(plugin, options) {
        return this.getPluginUnsupportedReason(plugin, options) === null;
    }

    createPluginSession(plugin, { channelCount, assets }) {
        if (this.closed) throw new Error('JavaScript benchmark runtime is closed');
        requirePositiveInteger(channelCount, 'channelCount', BENCHMARK_DSP_MAX_CHANNELS);
        const unsupportedReason = this.getPluginUnsupportedReason(plugin, { channelCount });
        if (unsupportedReason) {
            throw new DspBenchmarkPluginUnavailableError(getPluginType(plugin), unsupportedReason);
        }
        if (assets instanceof Map && assets.size > 0) {
            throw new DspBenchmarkPluginUnavailableError(getPluginType(plugin));
        }
        return new JavascriptBenchmarkSession(plugin, {
            sampleRate: this.sampleRate,
            blockSize: this.blockSize,
            channelCount
        });
    }

    close() {
        this.closed = true;
    }
}

class WasmBenchmarkSession {
    constructor(runtime, plugin, instanceId, arena, channelCount, assetSlots, soundFont) {
        this.runtime = runtime;
        this.plugin = plugin;
        this.instanceId = instanceId;
        this.arena = arena;
        this.channelCount = channelCount;
        this.sampleCount = channelCount * runtime.blockSize;
        this.assetSlots = assetSlots;
        this.soundFont = soundFont;
        this.closed = false;
    }

    startSoundFontNotes() {
        const { binding } = this.runtime;
        const events = this.soundFont.notes.map((key, noteId) => ({
            status: SOUNDFONT_NOTE_ON, data1: key, data2: SOUNDFONT_NOTE_VELOCITY, offsetFrames: 0, noteId
        }));
        assertStatus(binding.instanceSetMidiEvents(this.instanceId, [], SOUNDFONT_MIDI_GENERATION, 1),
            'WebAssembly benchmark MIDI reset');
        assertStatus(binding.instanceSetMidiClock(this.instanceId, 0, SOUNDFONT_MIDI_GENERATION, 1),
            'WebAssembly benchmark MIDI clock');
        assertStatus(binding.instanceSetMidiEvents(this.instanceId, events, SOUNDFONT_MIDI_GENERATION, 0),
            'WebAssembly benchmark note start');
    }

    prepareAssets() {
        if (this.closed) throw new Error('WebAssembly benchmark session is closed');
        if (this.assetSlots.length === 0) return 0;

        const maximumBlocks = Math.ceil(2 * this.runtime.sampleRate / this.runtime.blockSize);
        let block = 0;
        while (block < maximumBlocks) {
            const states = this.assetSlots.map(slot =>
                this.runtime.binding.instanceAssetState(this.instanceId, slot) & 0xff
            );
            if (states.every(state => state === DSP_ASSET_STATE_ACTIVE)) break;
            if (states.some(state => state !== DSP_ASSET_STATE_PREPARING)) {
                throw new Error('WebAssembly benchmark asset preparation failed');
            }
            this.arena.combined.fill(0, 0, this.sampleCount);
            assertStatus(
                this.runtime.binding.pipelineProcess(
                    this.channelCount,
                    this.runtime.blockSize,
                    block * this.runtime.blockSize / this.runtime.sampleRate,
                    false
                ),
                'WebAssembly benchmark asset preparation'
            );
            block++;
        }

        const ready = this.assetSlots.every(slot =>
            (this.runtime.binding.instanceAssetState(this.instanceId, slot) & 0xff) ===
                DSP_ASSET_STATE_ACTIVE
        );
        if (!ready) throw new Error('WebAssembly benchmark asset preparation timed out');
        assertStatus(
            this.runtime.binding.resetInstance(this.instanceId),
            'WebAssembly benchmark instance reset'
        );
        if (this.soundFont) this.startSoundFontNotes();
        return block;
    }

    process(inputData, timeSeconds) {
        if (this.closed) throw new Error('WebAssembly benchmark session is closed');
        if (!(inputData instanceof Float32Array) || inputData.length !== this.sampleCount) {
            throw new TypeError(`WebAssembly benchmark input must contain ${this.sampleCount} Float32 samples`);
        }
        this.arena.combined.set(inputData, 0);
        assertStatus(
            this.runtime.binding.pipelineProcess(
                this.channelCount,
                this.runtime.blockSize,
                timeSeconds,
                false
            ),
            'et_pipeline_process'
        );
        return this.arena.combined.subarray(0, this.sampleCount);
    }

    close() {
        if (this.closed) return;
        this.closed = true;
        this.runtime.releaseSession(this);
    }
}

class WasmBenchmarkRuntime {
    constructor({
        binding,
        moduleInfo,
        enabledTypes,
        sampleRate,
        blockSize,
        warning
    }) {
        this.binding = binding;
        this.moduleInfo = moduleInfo;
        this.enabledTypes = enabledTypes;
        this.sampleRate = sampleRate;
        this.blockSize = blockSize;
        this.warning = warning;
        this.label = moduleInfo.simd ? 'WebAssembly (SIMD)' : 'WebAssembly (baseline)';
        this.variant = moduleInfo.simd ? 'simd' : 'baseline';
        this.usesWasm = true;
        this.supportsAssets = true;
        this.closed = false;
        this.activeSession = null;
        this.telemetryPacket = new ArrayBuffer(BENCHMARK_DSP_TELEMETRY_BYTES);
    }

    getPluginUnsupportedReason(pluginOrType, { channelCount = 2 } = {}) {
        const typeName = typeof pluginOrType === 'string'
            ? pluginOrType
            : getPluginType(pluginOrType);
        if (!this.enabledTypes.has(typeName)) {
            return 'WebAssembly DSP is not enabled for this plugin';
        }
        return getBenchmarkFormatUnsupportedReason(pluginOrType, this.sampleRate, channelCount);
    }

    supportsPlugin(pluginOrType, options) {
        return this.getPluginUnsupportedReason(pluginOrType, options) === null;
    }

    createPluginSession(plugin, { channelCount, assets = new Map() }) {
        if (this.closed) throw new Error('WebAssembly benchmark runtime is closed');
        if (this.activeSession) {
            throw new Error('Close the active WebAssembly benchmark session before creating another one');
        }
        requirePositiveInteger(channelCount, 'channelCount', BENCHMARK_DSP_MAX_CHANNELS);

        const typeName = getPluginType(plugin);
        const unsupportedReason = this.getPluginUnsupportedReason(plugin, { channelCount });
        if (unsupportedReason) {
            throw new DspBenchmarkPluginUnavailableError(typeName, unsupportedReason);
        }
        if (!(assets instanceof Map)) {
            throw new TypeError('WebAssembly benchmark assets must be provided as a Map');
        }
        const packer = this.moduleInfo.paramPackers.get(typeName);
        if (!packer || typeof packer.pack !== 'function') {
            throw new DspBenchmarkPluginUnavailableError(typeName);
        }

        const parameters = preparePlugin(
            plugin,
            this.sampleRate,
            this.blockSize,
            channelCount
        );
        let instanceId = 0;
        try {
            instanceId = this.binding.createInstance(typeName);
            if (!instanceId) throw new Error('instance creation returned 0');
            assertStatus(
                this.binding.instanceSetTap(instanceId, plugin.id >>> 0),
                `${typeName} tap binding`
            );

            const packed = packer.pack(parameters);
            if (!(packed instanceof Float32Array)) {
                throw new TypeError(`${typeName} parameter packer did not return Float32Array`);
            }
            assertStatus(
                this.binding.instanceSetParams(instanceId, packed, packer.hash >>> 0),
                `${typeName} parameter update`
            );

            if (typeof packer.packBytes === 'function') {
                const packedBytes = packer.packBytes(parameters);
                if (!(packedBytes instanceof Uint8Array) ||
                    !Number.isInteger(packer.byteCapacity) ||
                    packedBytes.byteLength > packer.byteCapacity) {
                    throw new TypeError(`${typeName} structured parameter packer returned an invalid payload`);
                }
                assertStatus(
                    this.binding.instanceSetParamBytes(
                        instanceId,
                        packedBytes,
                        packer.hash >>> 0
                    ),
                    `${typeName} structured parameter update`
                );
            }

            const assetSlots = [];
            let soundFont = null;
            for (const [slot, asset] of assets) {
                if (!Number.isInteger(slot) || slot < 0 ||
                    !(asset?.payload instanceof ArrayBuffer)) {
                    throw new TypeError(`${typeName} benchmark asset is invalid`);
                }
                assertStatus(
                    this.binding.instanceSetAsset(
                        instanceId,
                        slot,
                        asset.payload,
                        asset.soundFont ? { ...asset, frames: asset.soundFont.frames, topology: 0 } : asset,
                        asset.formatTag
                    ),
                    `${typeName} asset staging`
                );
                if (asset.soundFont) {
                    soundFont = asset.soundFont;
                    assertStatus(
                        this.binding.configureSfzSampleStream(instanceId, SOUNDFONT_STREAM_GENERATION),
                        `${typeName} sample stream configuration`
                    );
                    for (const page of soundFont.pages) {
                        assertStatus(
                            this.binding.publishSfzSamplePage(instanceId, {
                                ...page, generation: SOUNDFONT_STREAM_GENERATION, resident: true
                            }),
                            `${typeName} sample page publication`
                        );
                    }
                }
                assetSlots.push(slot);
            }

            const descriptorParameters = {
                ...parameters,
                // The existing multichannel benchmark passes every channel to the plugin.
                channel: channelCount > 2
                    ? 'A'
                    : (parameters.channel ?? plugin.channel ?? null)
            };
            const descriptor = buildDspPipelineDescriptor([plugin], {
                getInstanceId: () => instanceId,
                getParameters: () => descriptorParameters,
                omitInactive: true
            });
            assertStatus(
                this.binding.pipelineConfigure(descriptor),
                `${typeName} pipeline configuration`
            );
            const arena = this.binding.getArenaViews();

            const session = new WasmBenchmarkSession(
                this,
                plugin,
                instanceId,
                arena,
                channelCount,
                assetSlots,
                soundFont
            );
            this.activeSession = session;
            return session;
        } catch (error) {
            if (instanceId) {
                try {
                    this.binding.destroyInstance(instanceId);
                } catch (cleanupError) {
                    this.warning(
                        `[dsp-wasm] Benchmark cleanup failed for ${typeName}: ` +
                        `${cleanupError?.message || String(cleanupError)}`
                    );
                }
            }
            throw new Error(
                `${typeName} WebAssembly benchmark setup failed: ${error?.message || String(error)}`
            );
        }
    }

    releaseSession(session) {
        if (this.activeSession !== session) return;
        this.activeSession = null;
        try {
            this.binding.destroyInstance(session.instanceId);
        } catch (error) {
            this.warning(
                `[dsp-wasm] Benchmark instance cleanup failed: ${error?.message || String(error)}`
            );
        }
        try {
            this.binding.telemetryRead?.(this.telemetryPacket);
        } catch (error) {
            this.warning(
                `[dsp-wasm] Benchmark telemetry cleanup failed: ${error?.message || String(error)}`
            );
        }
    }

    close() {
        if (this.closed) return;
        if (this.activeSession) this.activeSession.close();
        this.closed = true;
        try {
            this.binding.close();
        } catch (error) {
            this.warning(
                `[dsp-wasm] Benchmark engine cleanup failed: ${error?.message || String(error)}`
            );
        }
    }
}

function prepareNativeBenchmarkPlugin(plugin, sampleRate, blockSize, channelCount) {
    const parameters = preparePlugin(plugin, sampleRate, blockSize, channelCount);
    if (channelCount > 2) parameters.channel = 'A';
    const { id, channel } = plugin;
    const descriptor = buildDspPipelineDescriptor([plugin], {
        getInstanceId: () => id,
        getParameters: () => parameters,
        omitInactive: true
    });
    const item = packed({ id, type: getPluginType(plugin), parameters, channel,
        executionCapabilities: getPluginExecutionCapabilities(plugin) }, sampleRate, channelCount, true);
    return { descriptor, item };
}

function getNativeBenchmarkUnsupportedReason(plugin, sampleRate, channelCount) {
    if (!DSP_PARAM_PACKERS.has(getPluginType(plugin))) return 'Native DSP is not available for this plugin';
    return getBenchmarkFormatUnsupportedReason(plugin, sampleRate, channelCount);
}

function completeBlockSamples(audioBuffer, blockSize, channelCount) {
    const blockSamples = blockSize * channelCount;
    return Math.floor(audioBuffer.length / blockSamples) * blockSamples;
}

function nativeWarmupBlocks(warmupFrames, blockSize) {
    return Math.max(NATIVE_BENCHMARK_MIN_WARMUP_BLOCKS, Math.ceil(warmupFrames / blockSize));
}

function formatNativeBenchmarkResult(result, elapsedNs, totalCalls, blockSize, sampleRate) {
    const elapsedSeconds = elapsedNs / 1e9;
    const samplesPerSecond = Math.round(totalCalls * blockSize / elapsedSeconds);
    return { ...result, samplesPerSecond, totalCalls, elapsedTime: elapsedSeconds.toFixed(3),
        speedupFactor: (samplesPerSecond / sampleRate).toFixed(1) };
}

class NativeBenchmarkRuntime {
    constructor({ connect, bridge, sampleRate, blockSize, warning }) {
        this.connect = connect;
        this.bridge = bridge;
        this.sampleRate = sampleRate;
        this.blockSize = blockSize;
        this.warning = warning;
        this.supportsAssets = true;
    }

    async openDriver() {
        try {
            const { ports: [control, ...unused], variant } = await this.connect('null', { bridge: this.bridge });
            for (const port of unused) port.close();
            this.client = new NativeControlClient(control);
            this.variant = variant;
            this.label = variant === 'v3' ? 'Native (AVX2)' : variant === 'baseline' ? 'Native (baseline)' : 'Native';
        } catch (error) {
            this.warning(`Native benchmark could not start: ${error.message}`);
            await this.bridge.stop();
            throw new DspBenchmarkUnavailableError('Native DSP could not start');
        }
    }

    getPluginUnsupportedReason(plugin, { channelCount = 2 } = {}) {
        return getNativeBenchmarkUnsupportedReason(plugin, this.sampleRate, channelCount);
    }

    supportsPlugin(plugin, options) {
        return this.getPluginUnsupportedReason(plugin, options) === null;
    }

    render(frames, attachment) {
        return this.client.request({ type: 'renderNull', frames, attachment }, 'nullOutput',
            result => result.frames === frames);
    }

    async prepareAssets(pluginId, assets, channelCount) {
        if (!assets.size) return;
        const pending = new Set(assets.keys());
        const soundFont = assets.get(SOUNDFONT_ASSET_SLOT)?.soundFont;
        let rejected = false;
        let streamGeneration = null;
        let midiPrepared = false;
        const receiveAsset = ({ data }) => {
            if (data.type === 'midiPrepared' && data.generation === SOUNDFONT_MIDI_GENERATION) midiPrepared = true;
            if (data.pluginId !== pluginId) return;
            if (data.type === 'sfzStreamReady') streamGeneration = data.generation;
            if (!pending.has(data.slot)) return;
            if (data.type === 'assetState' && data.state === DSP_ASSET_STATE_ACTIVE) pending.delete(data.slot);
            if (data.type === 'assetLoadRejected') rejected = true;
        };
        this.client.port.addEventListener('message', receiveAsset);
        try {
            for (const [slot, { payload, soundFont: _soundFont, ...asset }] of assets) {
                this.client.send({ type: 'setPluginAsset', pluginId, slot, operationRevision: 1, ...asset,
                    attachment: payload });
            }
            const deadline = performance.now() + NATIVE_BENCHMARK_ASSET_TIMEOUT_MS;
            const silence = new Float32Array(this.blockSize * channelCount);
            const renderUntil = async (done, reason, poll = false) => {
                while (!done() && performance.now() < deadline) {
                    // Score preparation admits notes only after a page poll confirms the resident sample.
                    if (poll) await this.pollSoundFontPages(pluginId, streamGeneration);
                    await this.render(this.blockSize, silence.buffer);
                    if (rejected) throw new Error('Asset rejected');
                }
                if (!done()) throw new Error(reason);
            };
            if (soundFont) {
                await renderUntil(() => streamGeneration !== null, 'SoundFont stream timed out');
                await this.publishSoundFontPages(pluginId, streamGeneration, soundFont.pages);
            }
            await renderUntil(() => !pending.size, 'Asset preparation timed out');
            if (soundFont) {
                // A timeline of sustained notes keeps every voice sounding for the whole measurement.
                this.client.send({ type: 'midiTransport', generation: SOUNDFONT_MIDI_GENERATION, position: 0,
                    preparing: true, timeline: { duration: SOUNDFONT_TIMELINE_SECONDS,
                        events: soundFont.notes.map(key => ({ seconds: 0, status: SOUNDFONT_NOTE_ON,
                            data1: key, data2: SOUNDFONT_NOTE_VELOCITY })) } });
                await renderUntil(() => midiPrepared, 'SoundFont notes did not prepare', true);
                this.client.send({ type: 'midiStart', generation: SOUNDFONT_MIDI_GENERATION, delayFrames: 0 });
            }
        } finally {
            this.client.port.removeEventListener('message', receiveAsset);
        }
    }

    async publishSoundFontPages(pluginId, generation, pages) {
        for (const { pcm, ...page } of pages) {
            const { ok } = await this.client.request({ type: 'sfzPublishPage', pluginId, operationRevision: 1,
                generation, requestId: 1, page: { ...page, generation, resident: true }, attachment: pcm.slice().buffer },
            'sfzStreamPagesPublished');
            if (!ok) throw new Error('SoundFont page was rejected');
        }
    }

    async pollSoundFontPages(pluginId, generation) {
        const { ok, requests } = await this.client.request({ type: 'sfzPollPages', pluginId, generation, requestId: 2 },
            'sfzStreamRequests');
        if (!ok || requests.length) throw new Error('SoundFont pages are not resident');
    }

    async benchmarkPlugin(plugin, audioBuffer, { channelCount, assets, warmupFrames }) {
        if (this.client.lifetime.signal.aborted) await this.openDriver();
        const { sampleRate, blockSize } = this;
        const type = getPluginType(plugin);
        const id = plugin.id;
        const result = { category: '', name: plugin.name, implementation: this.label };
        let failureNote = NATIVE_BENCHMARK_FAILURE_NOTES.setup;
        let opened = false;
        try {
            const { descriptor, item } = prepareNativeBenchmarkPlugin(plugin, sampleRate, blockSize, channelCount);
            const { records, ...binary } = packRecords([item], descriptor);
            const state = await this.client.request({ type: 'openSession', sampleRate, outputChannels: channelCount,
                inputChannels: 0, periodFrames: blockSize }, 'sessionState',
            reply => reply.state === 'open' || reply.state === 'failed');
            if (state.state !== 'open') throw new Error(`Could not open benchmark session: ${state.reason}`);
            opened = true;
            await this.client.request({ type: 'configurePipeline', revision: 1, plugins: records, ...binary },
                'pipelineApplied', reply => reply.revision === 1);

            failureNote = NATIVE_BENCHMARK_FAILURE_NOTES.asset;
            await this.prepareAssets(id, assets, channelCount);

            failureNote = NATIVE_BENCHMARK_FAILURE_NOTES.processing;
            const completeSamples = completeBlockSamples(audioBuffer, blockSize, channelCount);
            if (!completeSamples) throw new Error('Benchmark input must contain a complete block');
            // The engine replays the input for one second of DSP time and returns only the totals.
            const { elapsedNanoseconds, blocks } = await this.client.request({ type: 'benchmarkNull', blockSize,
                warmupBlocks: nativeWarmupBlocks(warmupFrames, blockSize),
                attachment: audioBuffer.slice(0, completeSamples).buffer }, 'benchmarkResult');
            if (!(elapsedNanoseconds > 0) || !Number.isInteger(blocks) || blocks <= 0) {
                throw new Error('Invalid native benchmark result');
            }
            return formatNativeBenchmarkResult(result, elapsedNanoseconds, blocks, blockSize, sampleRate);
        } catch (error) {
            this.warning(`Native benchmark failed for ${type}: ${error.message}`);
            return { ...result, samplesPerSecond: null, speedupFactor: null, skipped: true, note: failureNote };
        } finally {
            if (opened && !this.client.lifetime.signal.aborted) {
                try {
                    await this.client.request({ type: 'closeSession' }, 'sessionState', reply => reply.state === 'closed');
                } catch (error) {
                    this.warning(`Native benchmark session could not close: ${error.message}`);
                }
            }
        }
    }

    async close() {
        this.client.close();
        await this.bridge.stop();
    }
}

class AndroidNativeBenchmarkRuntime {
    constructor({ bridge, sampleRate, blockSize, warning }) {
        Object.assign(this, { bridge, sampleRate, blockSize, warning });
        this.label = 'Native';
        this.supportsAssets = true;
        this.input = null;
        this.closed = false;
        this.release = () => { void this.close(); };
        this.window = globalThis.window;
        this.window.addEventListener('pagehide', this.release);
    }

    getPluginUnsupportedReason(plugin, { channelCount = 2 } = {}) {
        return getNativeBenchmarkUnsupportedReason(plugin, this.sampleRate, channelCount);
    }

    supportsPlugin(plugin, options) {
        return this.getPluginUnsupportedReason(plugin, options) === null;
    }

    async upload(kind, bytes) {
        const chunkBytes = 256 * 1024;
        for (let offset = 0; offset < bytes.byteLength; offset += chunkBytes) {
            if (this.closed) throw new Error('Benchmark is closed');
            await this.bridge.request('benchmark.upload', { kind, offset, byteLength: bytes.byteLength,
                data: bytesToBase64(bytes.subarray(offset, offset + chunkBytes)) });
        }
    }

    async benchmarkPlugin(plugin, audioBuffer, { channelCount, assets, warmupFrames }) {
        const { sampleRate, blockSize } = this;
        const result = { category: '', name: plugin.name, implementation: this.label };
        let failureNote = NATIVE_BENCHMARK_FAILURE_NOTES.setup;
        try {
            const { descriptor, item } = prepareNativeBenchmarkPlugin(plugin, sampleRate, blockSize, channelCount);
            const { id, type, layoutHash, skip, floats, bytes } = item;
            const completeSamples = completeBlockSamples(audioBuffer, blockSize, channelCount);
            if (skip || !completeSamples) throw new Error('Invalid benchmark effect or input');
            if (this.input !== audioBuffer || this.inputChannels !== channelCount) {
                this.input = null;
                await this.upload('input', new Uint8Array(audioBuffer.buffer, audioBuffer.byteOffset,
                    completeSamples * Float32Array.BYTES_PER_ELEMENT));
                this.input = audioBuffer;
                this.inputChannels = channelCount;
            }

            let asset;
            if (assets.size) {
                failureNote = NATIVE_BENCHMARK_FAILURE_NOTES.asset;
                if (assets.size !== 1) throw new Error('Android benchmark expects one asset per effect');
                const [slot, { payload, preparationContext: _context, soundFont, ...metadata }] =
                    assets.entries().next().value;
                asset = { ...metadata, slot, byteLength: payload.byteLength, ...(soundFont && { soundFont: {
                    notes: soundFont.notes,
                    pages: soundFont.pages.map(({ pcm, ...page }) => ({ ...page,
                        pcm: bytesToBase64(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength)) }))
                } }) };
                await this.upload('asset', new Uint8Array(payload));
            }

            if (this.closed) throw new Error('Benchmark is closed');
            failureNote = NATIVE_BENCHMARK_FAILURE_NOTES.processing;
            const { status, elapsedNs, blocks } = await this.bridge.request('benchmark.run', {
                rate: sampleRate, channels: channelCount, blockSize,
                warmupBlocks: nativeWarmupBlocks(warmupFrames, blockSize), asset,
                plugins: [{ id, type, layoutHash, parameterValues: Array.from(floats),
                    ...(bytes && { parameterBytes: bytesToBase64(bytes) }) }],
                descriptor: bytesToBase64(descriptor)
            });
            if (status === 'setup' || status === 'asset') failureNote = NATIVE_BENCHMARK_FAILURE_NOTES[status];
            if (status !== 'ok' || !Number.isFinite(elapsedNs) || elapsedNs <= 0 ||
                !Number.isInteger(blocks) || blocks <= 0) {
                throw new Error(`Invalid native benchmark result: ${status}`);
            }
            return formatNativeBenchmarkResult(result, elapsedNs, blocks, blockSize, sampleRate);
        } catch (error) {
            this.warning(`Native benchmark failed for ${getPluginType(plugin)}: ${error.message}`);
            return { ...result, samplesPerSecond: null, speedupFactor: null, skipped: true, note: failureNote };
        }
    }

    async close() {
        if (this.closed) return;
        this.closed = true;
        this.input = null;
        this.window.removeEventListener('pagehide', this.release);
        try {
            await this.bridge.request('benchmark.release');
        } catch (error) {
            this.warning(`Native benchmark input could not be released: ${error.message}`);
        }
    }
}

async function createNativeBenchmarkRuntime({ sampleRate, blockSize, dependencies }) {
    const warning = dependencies.warning || defaultWarning;
    if (isAndroidHost()) {
        return new AndroidNativeBenchmarkRuntime({
            bridge: dependencies.androidBridge || getAndroidBridge(), sampleRate, blockSize, warning
        });
    }
    const bridge = dependencies.audioEngine || globalThis.window?.electronAPI?.audioEngine;
    if (!bridge) throw new DspBenchmarkUnavailableError('Native DSP is unavailable');
    const connect = dependencies.connectAudioEngine || connectAudioEngine;
    const runtime = new NativeBenchmarkRuntime({ connect, bridge, sampleRate, blockSize, warning });
    await runtime.openDriver();
    return runtime;
}

async function createWasmBenchmarkRuntime({
    sampleRate,
    blockSize,
    preference,
    location,
    basePath,
    dependencies
}) {
    const warning = dependencies.warning || defaultWarning;
    const getRollout = dependencies.getDspRolloutConfig || getDspRolloutConfig;
    const loadModule = dependencies.loadDspModule || loadDspModule;
    const instantiate = dependencies.instantiateDsp || instantiateDsp;

    if (preference === false ||
        (preference && typeof preference === 'object' && preference.useWasmDsp === false)) {
        throw new DspBenchmarkUnavailableError(
            'WebAssembly DSP is disabled by the useWasmDsp setting'
        );
    }

    const preflight = getRollout({ preference, location });
    if (preflight.forceOff) {
        throw new DspBenchmarkUnavailableError(
            'WebAssembly DSP is disabled by the dsp=off runtime flag'
        );
    }

    const moduleInfo = await loadModule({
        basePath,
        warning
    });
    if (!moduleInfo) {
        throw new DspBenchmarkUnavailableError(
            'WebAssembly DSP could not be loaded; no JavaScript fallback was measured'
        );
    }

    const rollout = getRollout({
        meta: moduleInfo.meta,
        paramPackers: moduleInfo.paramPackers,
        preference,
        location
    });
    const moduleOrBytes = moduleInfo.module || moduleInfo.bytes;
    if (!moduleOrBytes) {
        throw new DspBenchmarkUnavailableError('Loaded WebAssembly DSP has no executable payload');
    }

    let binding = null;
    try {
        binding = await instantiate(moduleOrBytes, {
            warning
        });
        if (!binding?.createEngine || !binding.createEngine()) {
            throw new Error('engine creation returned 0');
        }
        assertStatus(
            binding.prepare(
                sampleRate,
                BENCHMARK_DSP_MAX_CHANNELS,
                blockSize,
                BENCHMARK_DSP_TELEMETRY_BYTES
            ),
            'DSP engine preparation'
        );
        if (binding.live === false) throw new Error('DSP engine is not live after preparation');
        if (typeof binding.setTelemetryRate === 'function') {
            assertStatus(
                binding.setTelemetryRate(BENCHMARK_DSP_TELEMETRY_RATE),
                'DSP telemetry-rate configuration'
            );
        }
        return new WasmBenchmarkRuntime({
            binding,
            moduleInfo,
            enabledTypes: new Set(rollout.enabledTypes || []),
            sampleRate,
            blockSize,
            warning
        });
    } catch (error) {
        try {
            binding?.close();
        } catch (cleanupError) {
            warning(
                `[dsp-wasm] Benchmark initialization cleanup failed: ` +
                `${cleanupError?.message || String(cleanupError)}`
            );
        }
        if (error instanceof DspBenchmarkUnavailableError) throw error;
        throw new DspBenchmarkUnavailableError(
            `WebAssembly DSP benchmark initialization failed: ${error?.message || String(error)}`
        );
    }
}

export async function createDspBenchmarkRuntime({
    mode,
    sampleRate,
    blockSize,
    preference = { useWasmDsp: true },
    location = globalThis.location,
    basePath = '..',
    dependencies = {}
}) {
    requirePositiveInteger(sampleRate, 'sampleRate');
    requirePositiveInteger(blockSize, 'blockSize');
    if (mode === BENCHMARK_DSP_MODES.JAVASCRIPT) {
        return new JavascriptBenchmarkRuntime(sampleRate, blockSize);
    }
    if (mode === BENCHMARK_DSP_MODES.WEBASSEMBLY) {
        return createWasmBenchmarkRuntime({
            sampleRate,
            blockSize,
            preference,
            location,
            basePath,
            dependencies
        });
    }
    if (mode === BENCHMARK_DSP_MODES.NATIVE) {
        return createNativeBenchmarkRuntime({ sampleRate, blockSize, dependencies });
    }
    throw new RangeError(`Unsupported benchmark DSP mode: ${String(mode)}`);
}
