import { buildDspPipelineDescriptor } from '../js/audio/dsp-pipeline-descriptor.js';
import { getPluginExecutionCapabilities } from '../js/audio/plugin-execution-capabilities.js';
import { getDspRolloutConfig } from '../js/audio/dsp-rollout.js';
import { instantiateDsp, loadDspModule } from '../js/audio/dsp-wasm-loader.js';
import {
    buildIrAssetPayload,
    IR_ASSET_FORMAT_TAG,
    IR_ASSET_TOPOLOGY
} from '../js/ir-library/ir-asset-payload.js';
import {
    estimateIrKernelCommitFootprint,
    resolveIrProcessingConfig
} from '../js/ir-library/ir-plugin-contract.js';

export const BENCHMARK_DSP_MODES = Object.freeze({
    JAVASCRIPT: 'javascript',
    WEBASSEMBLY: 'webassembly'
});

export const BENCHMARK_DSP_MAX_CHANNELS = 16;
export const BENCHMARK_DSP_TELEMETRY_BYTES = 256 * 1024;
export const BENCHMARK_DSP_TELEMETRY_RATE = 60;
export const BENCHMARK_IR_REVERB_FRAMES = 256 * 1024;
export const BENCHMARK_IR_REVERB_NOTE =
    'True Stereo; deterministic 4-channel IR, 256K samples/channel ' +
    '(IR load/preparation excluded from timing)';
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
const IR_REVERB_ASSET_SLOT = 0;
const IR_REVERB_CHANNELS = 4;

export class DspBenchmarkUnavailableError extends Error {
    constructor(message) {
        super(message);
        this.name = 'DspBenchmarkUnavailableError';
    }
}

export class DspBenchmarkPluginUnavailableError extends Error {
    constructor(typeName) {
        super(`${typeName} is not enabled for WebAssembly DSP benchmarking`);
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
        this.closed = false;
    }

    process(inputData, timeSeconds) {
        if (this.closed) throw new Error('JavaScript benchmark session is closed');
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
        this.closed = false;
    }

    supportsPlugin(plugin) {
        return getPluginExecutionCapabilities(plugin)?.requiresWasm !== true;
    }

    createPluginSession(plugin, { channelCount, assets }) {
        if (this.closed) throw new Error('JavaScript benchmark runtime is closed');
        requirePositiveInteger(channelCount, 'channelCount', BENCHMARK_DSP_MAX_CHANNELS);
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
    constructor(runtime, plugin, instanceId, arena, channelCount, assetSlots) {
        this.runtime = runtime;
        this.plugin = plugin;
        this.instanceId = instanceId;
        this.arena = arena;
        this.channelCount = channelCount;
        this.sampleCount = channelCount * runtime.blockSize;
        this.assetSlots = assetSlots;
        this.closed = false;
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
        this.closed = false;
        this.activeSession = null;
        this.telemetryPacket = new ArrayBuffer(BENCHMARK_DSP_TELEMETRY_BYTES);
    }

    supportsPlugin(pluginOrType) {
        const typeName = typeof pluginOrType === 'string'
            ? pluginOrType
            : getPluginType(pluginOrType);
        return this.enabledTypes.has(typeName);
    }

    createPluginSession(plugin, { channelCount, assets = new Map() }) {
        if (this.closed) throw new Error('WebAssembly benchmark runtime is closed');
        if (this.activeSession) {
            throw new Error('Close the active WebAssembly benchmark session before creating another one');
        }
        requirePositiveInteger(channelCount, 'channelCount', BENCHMARK_DSP_MAX_CHANNELS);

        const typeName = getPluginType(plugin);
        if (!this.supportsPlugin(typeName)) {
            throw new DspBenchmarkPluginUnavailableError(typeName);
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
                        asset,
                        asset.formatTag
                    ),
                    `${typeName} asset staging`
                );
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
                assetSlots
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
    throw new RangeError(`Unsupported benchmark DSP mode: ${String(mode)}`);
}
