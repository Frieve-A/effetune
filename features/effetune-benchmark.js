import { buildDspPipelineDescriptor } from '../js/audio/dsp-pipeline-descriptor.js';
import { getDspRolloutConfig } from '../js/audio/dsp-rollout.js';
import { instantiateDsp, loadDspModule } from '../js/audio/dsp-wasm-loader.js';

export const BENCHMARK_DSP_MODES = Object.freeze({
    JAVASCRIPT: 'javascript',
    WEBASSEMBLY: 'webassembly'
});

export const BENCHMARK_DSP_MAX_CHANNELS = 8;
export const BENCHMARK_DSP_TELEMETRY_BYTES = 256 * 1024;
export const BENCHMARK_DSP_TELEMETRY_RATE = 60;

const DSP_OK = 0;

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

    supportsPlugin() {
        return true;
    }

    createPluginSession(plugin, { channelCount }) {
        if (this.closed) throw new Error('JavaScript benchmark runtime is closed');
        requirePositiveInteger(channelCount, 'channelCount', BENCHMARK_DSP_MAX_CHANNELS);
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
    constructor(runtime, plugin, instanceId, arena, channelCount) {
        this.runtime = runtime;
        this.plugin = plugin;
        this.instanceId = instanceId;
        this.arena = arena;
        this.channelCount = channelCount;
        this.sampleCount = channelCount * runtime.blockSize;
        this.closed = false;
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
        debug,
        warning
    }) {
        this.binding = binding;
        this.moduleInfo = moduleInfo;
        this.enabledTypes = enabledTypes;
        this.sampleRate = sampleRate;
        this.blockSize = blockSize;
        this.debug = debug;
        this.warning = warning;
        this.label = debug
            ? 'WebAssembly (debug)'
            : (moduleInfo.simd ? 'WebAssembly (SIMD)' : 'WebAssembly (baseline)');
        this.variant = debug ? 'debug' : (moduleInfo.simd ? 'simd' : 'baseline');
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

    createPluginSession(plugin, { channelCount }) {
        if (this.closed) throw new Error('WebAssembly benchmark runtime is closed');
        if (this.activeSession) {
            throw new Error('Close the active WebAssembly benchmark session before creating another one');
        }
        requirePositiveInteger(channelCount, 'channelCount', BENCHMARK_DSP_MAX_CHANNELS);

        const typeName = getPluginType(plugin);
        if (!this.supportsPlugin(typeName)) {
            throw new DspBenchmarkPluginUnavailableError(typeName);
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

            const arena = this.binding.getArenaViews();
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

            const session = new WasmBenchmarkSession(
                this,
                plugin,
                instanceId,
                arena,
                channelCount
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
        debug: Boolean(preflight.debug),
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
            debug: Boolean(rollout.debug),
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
            debug: Boolean(rollout.debug),
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
