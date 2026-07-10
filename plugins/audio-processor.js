// IMPORTANT: Do not add individual plugin implementations directly in this file.
// This file contains the core audio processing infrastructure.
// Plugin implementations should be created in their own files under the plugins directory.
// See docs/plugin-development.md for plugin development guidelines.

// __ETDSP_BINDING_INJECT_START__
const REQUIRED_FUNCTION_EXPORTS = [
    'malloc',
    'free',
    'et_abi_version',
    'et_build_flags',
    'et_kernel_count',
    'et_kernel_name',
    'et_kernel_params_hash',
    'et_kernel_param_bytes_capacity',
    'et_engine_memory_required',
    'et_engine_create',
    'et_engine_destroy',
    'et_engine_prepare',
    'et_engine_reset',
    'et_engine_set_telemetry_rate',
    'et_instance_create',
    'et_instance_destroy',
    'et_instance_reset',
    'et_instance_latency',
    'et_instance_set_tap',
    'et_instance_set_seed',
    'et_instance_set_params',
    'et_instance_set_param_bytes',
    'et_instance_process',
    'et_arena_combined_ptr',
    'et_arena_bus_ptr',
    'et_arena_scratch_ptr',
    'et_scratch_ptr',
    'et_telemetry_staging_ptr',
    'et_telemetry_capacity',
    'et_telemetry_read',
    'et_pipeline_configure',
    'et_pipeline_process'
];

const ET_OK = 0;
const ET_ERR_STATE = -2;
const SCRATCH_BYTES = 4096;
const WASI_ERRNO_SUCCESS = 0;

function defaultWarning(message) {
    if (globalThis.console?.warn) {
        globalThis.console.warn(message);
    }
}

function defaultDebugWrite(message) {
    if (globalThis.console?.error) {
        globalThis.console.error(message);
    }
}

function isArrayBuffer(value) {
    return value instanceof ArrayBuffer;
}

function toUint8View(value, label) {
    if (value instanceof Uint8Array) {
        return value;
    }
    if (isArrayBuffer(value)) {
        return new Uint8Array(value);
    }
    if (ArrayBuffer.isView(value)) {
        return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    }
    throw new TypeError(`${label} must be an ArrayBuffer or typed-array view`);
}

function decodeUtf8(bytes) {
    if (typeof TextDecoder === 'function') {
        return new TextDecoder().decode(bytes);
    }
    let text = '';
    for (let i = 0; i < bytes.length; i++) {
        text += String.fromCharCode(bytes[i]);
    }
    return text;
}

function encodeUtf8(text) {
    if (typeof TextEncoder === 'function') {
        return new TextEncoder().encode(text);
    }
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        if (code > 0x7f) {
            throw new TypeError('A TextEncoder is required for non-ASCII DSP names');
        }
        bytes[i] = code;
    }
    return bytes;
}

function mergeImports(base, extra) {
    if (!extra) return base;
    const merged = { ...base };
    for (const [moduleName, imports] of Object.entries(extra)) {
        merged[moduleName] = { ...(base[moduleName] || {}), ...imports };
    }
    return merged;
}

class DspBindingError extends Error {
    constructor(message) {
        super(message);
        this.name = 'DspBindingError';
    }
}

function createDspImports({
    getMemory = () => null,
    debug = false,
    debugWrite = defaultDebugWrite,
    onMemoryGrowth = () => {}
} = {}) {
    const fdWrite = (fd, iovPtr, iovCount, writtenPtr) => {
        const memory = getMemory();
        if (!memory?.buffer) return WASI_ERRNO_SUCCESS;

        let written = 0;
        const chunks = [];
        try {
            const data = new DataView(memory.buffer);
            for (let i = 0; i < iovCount; i++) {
                const entry = iovPtr + i * 8;
                const ptr = data.getUint32(entry, true);
                const length = data.getUint32(entry + 4, true);
                if (ptr + length > memory.buffer.byteLength) break;
                written += length;
                if (debug && length > 0) {
                    chunks.push(new Uint8Array(memory.buffer, ptr, length));
                }
            }
            if (writtenPtr + 4 <= memory.buffer.byteLength) {
                data.setUint32(writtenPtr, written, true);
            }
        } catch {
            return WASI_ERRNO_SUCCESS;
        }

        if (debug && chunks.length > 0 && (fd === 1 || fd === 2)) {
            const total = new Uint8Array(written);
            let offset = 0;
            for (const chunk of chunks) {
                total.set(chunk, offset);
                offset += chunk.length;
            }
            debugWrite(decodeUtf8(total));
        }
        return WASI_ERRNO_SUCCESS;
    };

    return {
        wasi_snapshot_preview1: {
            proc_exit(code) {
                throw new DspBindingError(`WASM requested proc_exit(${code})`);
            },
            fd_write: fdWrite,
            fd_close() {
                return WASI_ERRNO_SUCCESS;
            },
            fd_seek() {
                return WASI_ERRNO_SUCCESS;
            }
        },
        env: {
            emscripten_notify_memory_growth() {
                onMemoryGrowth();
            }
        }
    };
}

class DspEngineBinding {
    constructor(instance, {
        warning = defaultWarning,
        onUnexpectedMemoryGrowth = null
    } = {}) {
        this.instance = instance?.instance || instance;
        this.exports = this.instance?.exports;
        this.warning = warning;
        this.onUnexpectedMemoryGrowth = onUnexpectedMemoryGrowth;
        this.engine = 0;
        this.prepared = false;
        this.failed = false;
        this.memoryGrowthViolation = false;
        this.lastTelemetryDroppedFrames = 0;
        this._preparing = false;
        this._memoryBuffer = null;
        this._warned = new Set();
        this._arenaViews = null;
        this._arenaRanges = [];
        this._maxChannels = 0;
        this._maxFrames = 0;
        this._telemetryStagingPtr = 0;
        this._telemetryDroppedPtr = 0;
        this._telemetryCapacity = 0;

        this._validateExports();
        this.memory = this.exports.memory;
        this._refreshViews(true);
    }

    _validateExports() {
        if (!this.exports || typeof this.exports !== 'object') {
            throw new DspBindingError('WASM instance exports are unavailable');
        }
        if (!this.exports.memory?.buffer) {
            throw new DspBindingError('Missing WASM export: memory');
        }
        for (const name of REQUIRED_FUNCTION_EXPORTS) {
            if (typeof this.exports[name] !== 'function') {
                throw new DspBindingError(`Missing WASM export: ${name}`);
            }
        }
    }

    _warnOnce(key, message) {
        if (this._warned.has(key)) return;
        this._warned.add(key);
        this.warning(`[dsp-wasm] ${message}`);
    }

    _refreshViews(initial = false) {
        const buffer = this.memory.buffer;
        if (buffer === this._memoryBuffer) return false;

        const unexpected = !initial && !this._preparing && this._memoryBuffer !== null;
        this._memoryBuffer = buffer;
        this.u8 = new Uint8Array(buffer);
        this.f32 = new Float32Array(buffer);
        this.dataView = new DataView(buffer);
        this._arenaViews = null;
        this._arenaRanges = [];

        if (unexpected) {
            this.memoryGrowthViolation = true;
            this._warnOnce('memory-growth', 'memory.buffer changed outside engine preparation');
            if (typeof this.onUnexpectedMemoryGrowth === 'function') {
                this.onUnexpectedMemoryGrowth();
            }
        }
        return true;
    }

    handleMemoryGrowthNotification() {
        return this._refreshViews();
    }

    checkMemoryBuffer() {
        const changed = this._refreshViews();
        return changed && this.memoryGrowthViolation && !this._preparing;
    }

    _assertRange(ptr, byteLength, label) {
        if (!Number.isInteger(ptr) || ptr < 0 || !Number.isInteger(byteLength) || byteLength < 0 ||
            ptr > this._memoryBuffer.byteLength - byteLength) {
            throw new DspBindingError(`${label} points outside WASM memory`);
        }
    }

    _writeScratchString(text) {
        if (!this.engine || !this.prepared) {
            throw new DspBindingError('DSP engine has not been prepared');
        }
        const bytes = encodeUtf8(String(text));
        if (bytes.length + 1 > SCRATCH_BYTES) {
            throw new DspBindingError('DSP name exceeds the scratch-buffer capacity');
        }
        this._refreshViews();
        const ptr = this.exports.et_scratch_ptr(this.engine) >>> 0;
        this._assertRange(ptr, SCRATCH_BYTES, 'DSP scratch buffer');
        this.u8.fill(0, ptr, ptr + bytes.length + 1);
        this.u8.set(bytes, ptr);
        return ptr;
    }

    getAbiVersion() {
        return this.exports.et_abi_version() >>> 0;
    }

    getBuildFlags() {
        return this.exports.et_build_flags() >>> 0;
    }

    getKernelCount() {
        return this.exports.et_kernel_count() >>> 0;
    }

    getKernelName(index) {
        if (!Number.isInteger(index) || index < 0 || index >= this.getKernelCount()) {
            throw new RangeError('Kernel index is out of range');
        }
        this._refreshViews();
        const useEngineScratch = Boolean(this.engine && this.prepared);
        const ptr = useEngineScratch
            ? this.exports.et_scratch_ptr(this.engine) >>> 0
            : this.exports.malloc(SCRATCH_BYTES) >>> 0;
        if (!ptr) throw new DspBindingError('Unable to allocate kernel-name staging memory');
        try {
            this._refreshViews();
            this._assertRange(ptr, SCRATCH_BYTES, 'DSP kernel-name buffer');
            const length = this.exports.et_kernel_name(index, ptr, SCRATCH_BYTES);
            if (!Number.isInteger(length) || length < 0 || length >= SCRATCH_BYTES) {
                throw new DspBindingError(`Invalid kernel name length for index ${index}`);
            }
            return decodeUtf8(this.u8.subarray(ptr, ptr + length));
        } finally {
            if (!useEngineScratch) this.exports.free(ptr);
        }
    }

    getKernelParamsHash(index) {
        if (!Number.isInteger(index) || index < 0 || index >= this.getKernelCount()) {
            throw new RangeError('Kernel index is out of range');
        }
        return this.exports.et_kernel_params_hash(index) >>> 0;
    }

    getKernelParamBytesCapacity(index) {
        if (!Number.isInteger(index) || index < 0 || index >= this.getKernelCount()) {
            throw new RangeError('Kernel index is out of range');
        }
        return this.exports.et_kernel_param_bytes_capacity(index) >>> 0;
    }

    getCapabilities() {
        const kernels = [];
        const count = this.getKernelCount();
        for (let index = 0; index < count; index++) {
            kernels.push({
                name: this.getKernelName(index),
                hash: this.getKernelParamsHash(index),
                byteCapacity: this.getKernelParamBytesCapacity(index),
                kernelIndex: index
            });
        }
        const buildFlags = this.getBuildFlags();
        return {
            abiVersion: this.getAbiVersion(),
            buildFlags,
            simd: (buildFlags & 1) !== 0,
            kernels
        };
    }

    memoryRequired(sampleRate, maxChannels, maxFrames, telemetryRingBytes) {
        return this.exports.et_engine_memory_required(
            sampleRate,
            maxChannels,
            maxFrames,
            telemetryRingBytes
        ) >>> 0;
    }

    createEngine() {
        if (this.engine) {
            throw new DspBindingError('DSP engine already exists');
        }
        const engine = this.exports.et_engine_create() >>> 0;
        if (!engine) {
            throw new DspBindingError('DSP engine creation failed');
        }
        this.engine = engine;
        return engine;
    }

    destroyEngine() {
        if (!this.engine) return;
        const engine = this.engine;
        this.engine = 0;
        this.prepared = false;
        this._arenaViews = null;
        this._arenaRanges = [];
        this.exports.et_engine_destroy(engine);
        this._telemetryStagingPtr = 0;
        this._telemetryDroppedPtr = 0;
        this._telemetryCapacity = 0;
    }

    prepare(sampleRate, maxChannels, maxFrames, telemetryRingBytes) {
        if (!this.engine) return ET_ERR_STATE;
        this.prepared = false;
        this._arenaViews = null;
        this._arenaRanges = [];
        this._telemetryStagingPtr = 0;
        this._telemetryDroppedPtr = 0;
        this._telemetryCapacity = 0;
        this._preparing = true;
        try {
            const status = this.exports.et_engine_prepare(
                this.engine,
                sampleRate,
                maxChannels,
                maxFrames,
                telemetryRingBytes
            );
            this._refreshViews();
            if (status === ET_OK) {
                this.prepared = true;
                this._maxChannels = maxChannels;
                this._maxFrames = maxFrames;
                this._telemetryStagingPtr = this.exports.et_telemetry_staging_ptr(this.engine) >>> 0;
                this._telemetryDroppedPtr = this.exports.et_scratch_ptr(this.engine) >>> 0;
                this._telemetryCapacity = this.exports.et_telemetry_capacity(this.engine) >>> 0;
                this._assertRange(
                    this._telemetryStagingPtr,
                    this._telemetryCapacity,
                    'Telemetry staging buffer'
                );
                this._assertRange(this._telemetryDroppedPtr, 4, 'Telemetry drop counter');
                this.getArenaViews();
            }
            return status;
        } finally {
            this._preparing = false;
        }
    }

    reset() {
        if (!this.engine) return ET_ERR_STATE;
        return this.exports.et_engine_reset(this.engine);
    }

    setTelemetryRate(rateHz) {
        if (!this.engine) return ET_ERR_STATE;
        return this.exports.et_engine_set_telemetry_rate(this.engine, rateHz);
    }

    createInstance(typeName) {
        if (!this.engine || !this.prepared) return 0;
        const namePtr = this._writeScratchString(typeName);
        this._preparing = true;
        let instanceId = 0;
        try {
            instanceId = this.exports.et_instance_create(this.engine, namePtr) >>> 0;
        } finally {
            // Kernel prepare may grow memory at this control-rate lifecycle boundary.
            this._refreshViews();
            this._preparing = false;
        }
        if (instanceId) this.getArenaViews();
        return instanceId;
    }

    destroyInstance(instanceId) {
        if (!this.engine || !instanceId) return;
        this.exports.et_instance_destroy(this.engine, instanceId);
    }

    resetInstance(instanceId) {
        if (!this.engine) return ET_ERR_STATE;
        return this.exports.et_instance_reset(this.engine, instanceId);
    }

    instanceLatency(instanceId) {
        if (!this.engine) return 0;
        return this.exports.et_instance_latency(this.engine, instanceId) >>> 0;
    }

    instanceSetTap(instanceId, tapId) {
        if (!this.engine) return ET_ERR_STATE;
        return this.exports.et_instance_set_tap(this.engine, instanceId, tapId >>> 0);
    }

    instanceSetSeed(instanceId, seedLow, seedHigh = 0) {
        if (!this.engine) return ET_ERR_STATE;
        return this.exports.et_instance_set_seed(
            this.engine,
            instanceId,
            seedLow >>> 0,
            seedHigh >>> 0
        );
    }

    instanceSetParams(instanceId, packed, paramsHash, offsetFrames = 0) {
        if (!this.engine || !this.prepared) return ET_ERR_STATE;
        const values = packed instanceof Float32Array ? packed : Float32Array.from(packed || []);
        const byteLength = values.length * Float32Array.BYTES_PER_ELEMENT;
        if (byteLength > SCRATCH_BYTES) {
            throw new DspBindingError('Packed parameters exceed the scratch-buffer capacity');
        }
        const ptr = this.exports.et_scratch_ptr(this.engine) >>> 0;
        this._refreshViews();
        this._assertRange(ptr, byteLength, 'Packed parameter block');
        new Float32Array(this._memoryBuffer, ptr, values.length).set(values);
        return this.exports.et_instance_set_params(
            this.engine,
            instanceId,
            ptr,
            values.length,
            paramsHash >>> 0,
            offsetFrames >>> 0
        );
    }

    instanceSetParamBytes(instanceId, packed, paramsHash, offsetFrames = 0) {
        if (!this.engine || !this.prepared) return ET_ERR_STATE;
        const values = toUint8View(packed, 'Structured parameter block');
        if (values.byteLength > SCRATCH_BYTES) {
            throw new DspBindingError('Structured parameters exceed the scratch-buffer capacity');
        }
        const ptr = this.exports.et_scratch_ptr(this.engine) >>> 0;
        this._refreshViews();
        this._assertRange(ptr, values.byteLength, 'Structured parameter block');
        new Uint8Array(this._memoryBuffer, ptr, values.byteLength).set(values);
        return this.exports.et_instance_set_param_bytes(
            this.engine,
            instanceId,
            ptr,
            values.byteLength,
            paramsHash >>> 0,
            offsetFrames >>> 0
        );
    }

    instanceProcess(instanceId, audioPtr, channelCount, frameCount, timeSeconds) {
        if (!this.engine) return ET_ERR_STATE;
        this._refreshViews();
        return this.exports.et_instance_process(
            this.engine,
            instanceId,
            audioPtr,
            channelCount,
            frameCount,
            timeSeconds
        );
    }

    arenaCombinedPtr() {
        if (!this.engine) return 0;
        return this.exports.et_arena_combined_ptr(this.engine) >>> 0;
    }

    arenaBusPtr(bus) {
        if (!this.engine) return 0;
        return this.exports.et_arena_bus_ptr(this.engine, bus) >>> 0;
    }

    arenaScratchPtr(which) {
        if (!this.engine) return 0;
        return this.exports.et_arena_scratch_ptr(this.engine, which) >>> 0;
    }

    scratchPtr() {
        if (!this.engine) return 0;
        return this.exports.et_scratch_ptr(this.engine) >>> 0;
    }

    _arenaView(ptr, floatLength, label) {
        this._assertRange(ptr, floatLength * Float32Array.BYTES_PER_ELEMENT, label);
        const view = new Float32Array(this._memoryBuffer, ptr, floatLength);
        this._arenaRanges.push({
            start: ptr,
            end: ptr + view.byteLength
        });
        return view;
    }

    getArenaViews() {
        if (!this.engine || !this.prepared) {
            throw new DspBindingError('DSP engine must be prepared before adopting arena views');
        }
        this._refreshViews();
        if (this._arenaViews?.buffer === this._memoryBuffer) return this._arenaViews;

        const floatLength = this._maxChannels * this._maxFrames;
        this._arenaRanges = [];
        const combinedPtr = this.arenaCombinedPtr();
        const combined = this._arenaView(combinedPtr, floatLength, 'Combined arena');
        const buses = new Map([[0, combined]]);
        const busOffsets = new Map([[0, combinedPtr]]);
        for (let bus = 1; bus <= 4; bus++) {
            const ptr = this.arenaBusPtr(bus);
            buses.set(bus, this._arenaView(ptr, floatLength, `Bus ${bus} arena`));
            busOffsets.set(bus, ptr);
        }

        const scratchNames = ['allChannels', 'mixing', 'stereo', 'mono'];
        const scratchLengths = [
            floatLength,
            floatLength,
            (this._maxChannels < 2 ? this._maxChannels : 2) * this._maxFrames,
            this._maxFrames
        ];
        const scratch = {};
        const scratchOffsets = {};
        for (let which = 0; which < scratchNames.length; which++) {
            const name = scratchNames[which];
            const ptr = this.arenaScratchPtr(which);
            scratch[name] = this._arenaView(ptr, scratchLengths[which], `${name} scratch arena`);
            scratchOffsets[name] = ptr;
        }

        this._arenaViews = {
            buffer: this._memoryBuffer,
            combined,
            buses,
            scratch,
            offsets: {
                combined: combinedPtr,
                buses: busOffsets,
                scratch: scratchOffsets
            }
        };
        return this._arenaViews;
    }

    pointerForArenaView(view) {
        if (!ArrayBuffer.isView(view) || view.buffer !== this._memoryBuffer) return null;
        const start = view.byteOffset;
        const end = start + view.byteLength;
        for (const range of this._arenaRanges) {
            if (start >= range.start && end <= range.end) return start;
        }
        return null;
    }

    telemetryRead(target) {
        if (!this.engine || !this.prepared) return 0;
        const targetView = toUint8View(target, 'Telemetry packet');
        const maxBytes = targetView.byteLength < this._telemetryCapacity
            ? targetView.byteLength
            : this._telemetryCapacity;
        if (maxBytes === 0) return 0;

        this._refreshViews();
        this.dataView.setUint32(this._telemetryDroppedPtr, 0, true);
        const bytes = this.exports.et_telemetry_read(
            this.engine,
            this._telemetryStagingPtr,
            maxBytes,
            this._telemetryDroppedPtr
        );
        this._refreshViews();
        if (!Number.isInteger(bytes) || bytes < 0 || bytes > maxBytes) {
            throw new DspBindingError('Telemetry reader returned an invalid byte count');
        }
        this.lastTelemetryDroppedFrames = this.dataView.getUint32(this._telemetryDroppedPtr, true);
        if (bytes > 0) {
            targetView.set(this.u8.subarray(this._telemetryStagingPtr, this._telemetryStagingPtr + bytes), 0);
        }
        return bytes;
    }

    pipelineConfigure(descriptor) {
        if (!this.engine) return ET_ERR_STATE;
        const bytes = toUint8View(descriptor, 'Pipeline descriptor');
        const allocationSize = bytes.byteLength || 1;
        const ptr = this.exports.malloc(allocationSize) >>> 0;
        this._refreshViews();
        if (!ptr) throw new DspBindingError('Unable to allocate pipeline descriptor staging memory');
        try {
            this._assertRange(ptr, allocationSize, 'Pipeline descriptor');
            this.u8.set(bytes, ptr);
            return this.exports.et_pipeline_configure(this.engine, ptr, bytes.byteLength);
        } finally {
            this.exports.free(ptr);
        }
    }

    pipelineProcess(channelCount, frameCount, timeSeconds, masterBypass = false) {
        if (!this.engine) return ET_ERR_STATE;
        this._refreshViews();
        return this.exports.et_pipeline_process(
            this.engine,
            channelCount,
            frameCount,
            timeSeconds,
            masterBypass ? 1 : 0
        );
    }

    markFailed() {
        this.failed = true;
    }

    get live() {
        return Boolean(this.engine && this.prepared && !this.failed && !this.memoryGrowthViolation);
    }

    close() {
        this.destroyEngine();
    }
}

async function instantiateDspBinding(moduleOrBytes, {
    webAssembly = globalThis.WebAssembly,
    imports = null,
    debug = false,
    debugWrite = defaultDebugWrite,
    warning = defaultWarning,
    onUnexpectedMemoryGrowth = null
} = {}) {
    if (!webAssembly || typeof webAssembly.instantiate !== 'function') {
        throw new DspBindingError('WebAssembly.instantiate is unavailable');
    }

    let memory = null;
    let binding = null;
    let pendingGrowthNotification = false;
    const baseImports = createDspImports({
        getMemory: () => memory,
        debug,
        debugWrite,
        onMemoryGrowth: () => {
            if (binding) {
                binding.handleMemoryGrowthNotification();
            } else {
                pendingGrowthNotification = true;
            }
        }
    });
    const result = await webAssembly.instantiate(moduleOrBytes, mergeImports(baseImports, imports));
    const instance = result?.instance || result;
    memory = instance?.exports?.memory || null;
    binding = new DspEngineBinding(instance, { warning, onUnexpectedMemoryGrowth });
    if (pendingGrowthNotification) {
        binding.handleMemoryGrowthNotification();
    }
    return binding;
}
// __ETDSP_BINDING_INJECT_END__

const ET_DSP_MAX_CHANNELS = 8;
const ET_DSP_MAX_FRAMES = 128;
const ET_DSP_ERR_ARGS = -1;
const ET_DSP_TELEMETRY_BYTES = 256 * 1024;
const ET_DSP_PACKET_POOL_SIZE = 3;
const ET_DSP_PIPELINE_FALLBACK = 0;
const ET_DSP_PIPELINE_PROCESSED = 1;
const ET_DSP_PIPELINE_ARENA_INVALID = -1;
const ET_DSP_PIPELINE_VERSION = 1;
const ET_DSP_PIPELINE_HEADER_BYTES = 8;
const ET_DSP_PIPELINE_NODE_BYTES = 12;
const ET_DSP_PIPELINE_MAX_NODES = 128;

function encodeWorkletDspChannelSpec(channel) {
    if (channel === null || channel === undefined) return -1;
    if (channel === 'A') return -2;
    if (channel === 'L') return 0;
    if (channel === 'R') return 1;
    if (channel === '34') return 17;
    if (channel === '56') return 18;
    if (channel === '78') return 19;
    if (typeof channel === 'string' && /^[1-8]$/.test(channel)) return Number(channel) - 1;
    throw new TypeError(`Unsupported DSP pipeline channel: ${String(channel)}`);
}

function encodeWorkletDspPipeline(nodes) {
    if (nodes.length > ET_DSP_PIPELINE_MAX_NODES) {
        throw new RangeError(`DSP pipeline exceeds ${ET_DSP_PIPELINE_MAX_NODES} nodes`);
    }
    const bytes = new Uint8Array(
        ET_DSP_PIPELINE_HEADER_BYTES + nodes.length * ET_DSP_PIPELINE_NODE_BYTES
    );
    const view = new DataView(bytes.buffer);
    view.setUint32(0, ET_DSP_PIPELINE_VERSION, true);
    view.setUint32(4, nodes.length, true);
    const seenInstances = new Set();
    for (let index = 0; index < nodes.length; index++) {
        const node = nodes[index];
        if (!Number.isInteger(node.instanceId) || node.instanceId <= 0 || node.instanceId > 0xffffffff ||
            seenInstances.has(node.instanceId)) {
            throw new TypeError(`Invalid DSP pipeline instance at node ${index}`);
        }
        if (!Number.isInteger(node.inputBus) || node.inputBus < 0 || node.inputBus > 4 ||
            !Number.isInteger(node.outputBus) || node.outputBus < 0 || node.outputBus > 4) {
            throw new TypeError(`Invalid DSP pipeline bus at node ${index}`);
        }
        seenInstances.add(node.instanceId);
        const offset = ET_DSP_PIPELINE_HEADER_BYTES + index * ET_DSP_PIPELINE_NODE_BYTES;
        view.setUint32(offset, node.instanceId, true);
        view.setUint8(offset + 4, 1);
        view.setUint8(offset + 5, node.inputBus);
        view.setUint8(offset + 6, node.outputBus);
        view.setInt8(offset + 7, encodeWorkletDspChannelSpec(node.channel));
        view.setUint8(offset + 8, 1);
    }
    return bytes;
}

class PluginProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();
        this.plugins = [];
        this.FADE_DURATION = 0.010; // 10ms fade for smoother transitions (Not used in process, but kept for context)
        this.currentFrame = 0;
        this.pluginProcessors = new Map();
        this.pluginContexts = new Map();
        this.processorRegistrationErrors = new Set();
        this.reportedMissingProcessors = new Set();
        this.masterBypass = false;

        // WebAssembly DSP state. The legacy processor registry remains authoritative
        // until a parity-gated type has a live instance with current packed params.
        this.dspBinding = null;
        this.dspLive = false;
        this.dspSimd = false;
        this.dspEnabledTypes = new Set();
        this.wasmKernels = new Map();
        this.wasmInstances = new Map();
        this.dspRuntimeFailures = new Map();
        this.dspFailedTypes = new Set();
        this.dspReportedFailures = new Set();
        this.dspPacketPool = [];
        this.dspTelemetryRateHz = null;
        this.dspSampleRate = globalThis.sampleRate;
        this.dspPendingInstanceDestroy = [];
        this.dspEngineNeedsCleanup = false;
        this.dspHybridInputBackup = new Float32Array(ET_DSP_MAX_CHANNELS * ET_DSP_MAX_FRAMES);
        this.dspInitGeneration = 0;
        this.dspPipelineReady = false;
        this.dspPipelineLatencySamples = 0;
        this.dspBenchEnabled = false;
        this.dspStats = {
            singleCallBlocks: 0,
            hybridInstanceCalls: 0,
            telemetryDroppedFrames: 0,
            lastPublishedOperations: 0
        };

        // Audio configuration
        this.outputChannelCount = options?.processorOptions?.initialOutputChannelCount ?? 2;
        this.lowLatencyMode = options?.processorOptions?.lowLatencyMode ?? false;

        // Message control
        this.lastMessageTime = 0;
        this.messageQueue = new Map();
        this.MESSAGE_INTERVAL = this.lowLatencyMode ? 8 : 16; // ms

        // Buffer management - blockSize will be updated in process
        this.blockSize = 128; // Default/initial block size
        this.combinedBuffer = null;
        // this.lastChannelCount = 0; // Not used in the provided process function

        // Bus management
        this.busBuffers = new Map(); // Map to store buffers for each bus
        this.MAX_BUSES = 4; // Maximum number of buses (Informational, not directly used in process optimization)

        // Buffer Pool for performance optimization
        this.bufferPool = this.createLegacyBufferPool();

        // Offline processing flag (Not used in process, but kept for context)
        // this.isOfflineProcessing = false;

        // Audio level monitoring for sleep mode
        this.audioLevelMonitoring = {
            lastInputActiveTime: 0,     // Last time input signal was detected
            lastOutputActiveTime: 0,    // Last time output signal was detected
            lastUserActivityTime: 0,    // Will be updated from main thread
            isSleepMode: false,
            SILENCE_THRESHOLD: -84,     // -84dB threshold for silence
            SILENCE_DURATION: 60,       // 60 seconds of silence before sleep
            // Cache the threshold in amplitude form
            _silenceThresholdAmplitude: Math.pow(10, -84 / 20)
        };

        // Message handler
        this.port.onmessage = (event) => {
            const data = event.data;
            switch(data.type) {
                case 'updatePlugin':
                    this.updatePlugin(data.plugin);
                    break;
                case 'updatePlugins':
                    // this.isOfflineProcessing = data.isOfflineProcessing ?? false; // Store if needed elsewhere
                    this.masterBypass = data.masterBypass ?? false;
                    this.updatePlugins(data.plugins);
                    break;
                case 'updateAudioConfig':
                    if (data.outputChannels !== undefined) {
                        this.outputChannelCount = data.outputChannels;
                        // Invalidate combined buffer if channel count changes drastically
                        this.combinedBuffer = null;
                        console.log(`Audio config updated: output channels = ${this.outputChannelCount}`);
                    }
                    if (data.lowLatencyMode !== undefined) {
                        this.lowLatencyMode = data.lowLatencyMode;
                        this.MESSAGE_INTERVAL = this.lowLatencyMode ? 8 : 16;
                    }
                    if (typeof data.sampleRate === 'number' && data.sampleRate > 0) {
                        this.dspSampleRate = data.sampleRate;
                    }
                    break;
                case 'dspModule':
                    this.initializeDsp(data);
                    break;
                case 'dspEnableTypes':
                    this.dspEnabledTypes = new Set(
                        (Array.isArray(data.types) ? data.types : [])
                            .filter(type => !this.dspFailedTypes.has(type))
                    );
                    this.reconcileDspInstances();
                    this.refreshDspPipeline();
                    break;
                case 'dspSetTelemetryRate':
                    if (typeof data.hz === 'number') {
                        this.dspTelemetryRateHz = data.hz;
                    }
                    if (this.dspLive && this.dspTelemetryRateHz !== null) {
                        const status = this.dspBinding.setTelemetryRate(this.dspTelemetryRateHz);
                        if (status !== 0) this.reportDspFailure('telemetry-rate', `status ${status}`);
                    }
                    break;
                case 'dspSetBench':
                    this.dspBenchEnabled = data.enabled === true;
                    this.dspStats.singleCallBlocks = 0;
                    this.dspStats.hybridInstanceCalls = 0;
                    this.dspStats.telemetryDroppedFrames = 0;
                    this.dspStats.lastPublishedOperations = 0;
                    break;
                case 'dspTelemetryReturn':
                    if (data.packet instanceof ArrayBuffer && this.dspPacketPool.length < ET_DSP_PACKET_POOL_SIZE) {
                        this.dspPacketPool.push(new Uint8Array(data.packet));
                    }
                    break;
                case 'dspCleanupFailed':
                    this.cleanupDspFailures();
                    break;
                case 'registerProcessor':
                    this.registerPluginProcessor(data.pluginType, data.processor);
                    break;
                case 'batchUpdatePlugins':
                    this.batchUpdatePlugins(data.plugins || []);
                    break;
                case 'addPlugin':
                    this.addPlugin(data.plugin, data.index);
                    break;
                case 'removePlugin':
                    this.removePlugin(data.pluginId);
                    break;
                case 'reorderPlugin':
                    this.reorderPlugin(data.fromIndex, data.toIndex);
                    break;
                case 'reset':
                    this.destroyAllDspInstances();
                    if (this.dspLive) this.dspBinding.reset();
                    this.plugins = [];
                    this.pluginContexts.clear();
                    this.masterBypass = false;
                    break;
                case 'userActivity':
                    { // Block scope for const time
                        // Use performance.now() or a similar high-resolution timer if available and appropriate
                        // For AudioWorklet, using currentFrame / sampleRate is standard practice.
                        const time = this.currentFrame / globalThis.sampleRate;
                        const monitoring = this.audioLevelMonitoring;
                        monitoring.lastUserActivityTime = time;

                        if (monitoring.isSleepMode) {
                            console.log("User activity detected, exiting sleep mode.");
                            monitoring.isSleepMode = false;
                            this.port.postMessage({
                                type: 'sleepModeChanged',
                                isSleepMode: false
                            });
                        }
                    }
                    break;
                // Add a case to update SILENCE_THRESHOLD dynamically if needed
                case 'updateSilenceThreshold':
                    if (typeof data.threshold === 'number') {
                         this.audioLevelMonitoring.SILENCE_THRESHOLD = data.threshold;
                         this.audioLevelMonitoring._silenceThresholdAmplitude = Math.pow(10, data.threshold / 20);
                    }
                     break;
                case 'setLowLatencyMode':
                    this.lowLatencyMode = !!data.enabled;
                    this.MESSAGE_INTERVAL = this.lowLatencyMode ? 8 : 16;
                    break;
            }
        };
    }

    async initializeDsp(data) {
        const generation = ++this.dspInitGeneration;
        const moduleOrBytes = data?.module ?? data?.bytes;
        if (!moduleOrBytes) {
            this.reportDspFailure('instantiate', 'module payload is missing');
            return;
        }

        this.disableDspEngine();
        let binding = null;
        try {
            binding = await instantiateDspBinding(moduleOrBytes, {
                onUnexpectedMemoryGrowth: () => {
                    this.failDspEngine('runtime', 'memory grew outside prepare');
                }
            });
            if (generation !== this.dspInitGeneration) {
                binding.close();
                return;
            }
            binding.createEngine();
            const status = binding.prepare(
                this.dspSampleRate || globalThis.sampleRate,
                ET_DSP_MAX_CHANNELS,
                ET_DSP_MAX_FRAMES,
                ET_DSP_TELEMETRY_BYTES
            );
            if (status !== 0) {
                binding.close();
                throw new Error(`prepare returned ${status}`);
            }

            const capabilities = binding.getCapabilities();
            this.dspBinding = binding;
            this.dspLive = true;
            if (this.dspTelemetryRateHz !== null) {
                const telemetryStatus = binding.setTelemetryRate(this.dspTelemetryRateHz);
                if (telemetryStatus !== 0) {
                    this.reportDspFailure('telemetry-rate', `status ${telemetryStatus}`);
                }
            }
            this.dspSimd = data.simd ?? capabilities.simd;
            this.wasmKernels = new Map(
                capabilities.kernels.map(kernel => [kernel.name, {
                    paramsHash: kernel.hash >>> 0,
                    byteCapacity: kernel.byteCapacity ?? 0
                }])
            );
            this.adoptDspArena();
            this.dspPacketPool = Array.from(
                { length: ET_DSP_PACKET_POOL_SIZE },
                () => new Uint8Array(ET_DSP_TELEMETRY_BYTES)
            );
            this.reconcileDspInstances();
            this.refreshDspPipeline();
            this.port.postMessage({
                type: 'dspReady',
                abiVersion: capabilities.abiVersion,
                kernels: capabilities.kernels.map(kernel => ({
                    name: kernel.name,
                    hash: kernel.hash >>> 0,
                    byteCapacity: kernel.byteCapacity ?? 0
                })),
                simd: this.dspSimd
            });
        } catch (error) {
            if (generation !== this.dspInitGeneration) {
                try { binding?.close(); } catch (_) { /* stale initialization cleanup */ }
                return;
            }
            this.disableDspEngine();
            this.reportDspFailure('instantiate', error?.message || String(error));
        }
    }

    createLegacyBufferPool() {
        const buses = new Map();
        for (let bus = 1; bus <= 4; bus++) {
            buses.set(bus, new Float32Array(ET_DSP_MAX_CHANNELS * ET_DSP_MAX_FRAMES));
        }
        return {
            combined: new Float32Array(ET_DSP_MAX_CHANNELS * ET_DSP_MAX_FRAMES),
            allChannels: new Float32Array(ET_DSP_MAX_CHANNELS * ET_DSP_MAX_FRAMES),
            stereo: new Float32Array(2 * ET_DSP_MAX_FRAMES),
            mono: new Float32Array(ET_DSP_MAX_FRAMES),
            mixing: new Float32Array(ET_DSP_MAX_CHANNELS * ET_DSP_MAX_FRAMES),
            buses
        };
    }

    adoptDspArena() {
        const arena = this.dspBinding.getArenaViews();
        this.bufferPool = {
            combined: arena.combined,
            allChannels: arena.scratch.allChannels,
            stereo: arena.scratch.stereo,
            mono: arena.scratch.mono,
            mixing: arena.scratch.mixing,
            buses: new Map(Array.from(arena.buses).filter(([bus]) => bus !== 0))
        };
        this.combinedBuffer = null;
    }

    disableDspEngine() {
        this.destroyAllDspInstances();
        if (this.dspBinding) {
            try {
                this.dspBinding.close();
            } catch (error) {
                this.reportDspFailure('destroy', error?.message || String(error));
            }
        }
        this.dspBinding = null;
        this.dspLive = false;
        this.dspPipelineReady = false;
        this.publishDspPipelineLatency(0);
        this.wasmKernels.clear();
        this.dspPacketPool = [];
        this.dspPendingInstanceDestroy = [];
        this.dspEngineNeedsCleanup = false;
        this.bufferPool = this.createLegacyBufferPool();
    }

    failDspEngine(stage, error) {
        if (!this.dspLive) return;
        this.dspLive = false;
        this.dspPipelineReady = false;
        this.publishDspPipelineLatency(0);
        this.wasmInstances.clear();
        this.dspPendingInstanceDestroy = [];
        this.dspEngineNeedsCleanup = true;
        this.bufferPool = this.createLegacyBufferPool();
        this.reportDspFailure(stage, error);
        this.port.postMessage({ type: 'dspCleanupNeeded' });
    }

    cleanupDspFailures() {
        if (this.dspEngineNeedsCleanup) {
            if (this.dspBinding) {
                try {
                    this.dspBinding.close();
                } catch (error) {
                    console.warn(`[dsp-wasm] Deferred engine cleanup failed: ${error?.message || String(error)}`);
                }
            }
            this.dspBinding = null;
            this.dspEngineNeedsCleanup = false;
            this.dspPendingInstanceDestroy = [];
            return;
        }
        if (!this.dspBinding) {
            this.dspPendingInstanceDestroy = [];
            return;
        }
        for (const instanceId of this.dspPendingInstanceDestroy) {
            this.dspBinding.destroyInstance(instanceId);
        }
        this.dspPendingInstanceDestroy = [];
    }

    reportDspFailure(stage, error) {
        const key = `${stage}:${error}`;
        if (this.dspReportedFailures.has(key)) return;
        this.dspReportedFailures.add(key);
        console.warn(`[dsp-wasm] ${stage} failed: ${error}`);
        this.port.postMessage({ type: 'dspFailed', stage, error: String(error) });
    }

    destroyAllDspInstances() {
        this.dspPipelineReady = false;
        if (this.dspBinding) {
            for (const entry of this.wasmInstances.values()) {
                this.dspBinding.destroyInstance(entry.id);
            }
        }
        this.wasmInstances.clear();
    }

    destroyDspInstance(pluginId) {
        this.dspPipelineReady = false;
        const entry = this.wasmInstances.get(pluginId);
        if (!entry) return;
        if (this.dspBinding) this.dspBinding.destroyInstance(entry.id);
        this.wasmInstances.delete(pluginId);
    }

    reconcileDspInstances() {
        if (!this.dspLive) return false;
        const currentIds = new Set(this.plugins.map(plugin => plugin.id));
        try {
            for (const pluginId of this.wasmInstances.keys()) {
                if (!currentIds.has(pluginId)) this.destroyDspInstance(pluginId);
            }
        } catch (error) {
            this.failDspEngine('reconcile', error?.message || String(error));
            return false;
        }
        let reconciled = true;
        for (const plugin of this.plugins) {
            if (!this.reconcileDspPluginSafely(plugin)) reconciled = false;
            if (!this.dspLive) break;
        }
        return reconciled;
    }

    reconcileDspPluginSafely(plugin) {
        try {
            this.reconcileDspPlugin(plugin);
            return true;
        } catch (error) {
            this.dspPipelineReady = false;
            if (this.dspLive) {
                this.runtimeFallback(
                    plugin,
                    `reconcile failed: ${error?.message || String(error)}`,
                    'reconcile'
                );
            }
            return false;
        }
    }

    reconcileDspPlugin(plugin) {
        if (!plugin) return;
        const kernel = this.wasmKernels.get(plugin.type);
        const eligible = this.dspLive && this.dspEnabledTypes.has(plugin.type) &&
            !this.dspFailedTypes.has(plugin.type) && kernel;
        let entry = this.wasmInstances.get(plugin.id);
        if (!eligible) {
            if (entry) this.destroyDspInstance(plugin.id);
            return;
        }
        if (entry && entry.type !== plugin.type) {
            this.destroyDspInstance(plugin.id);
            entry = null;
        }
        if (!entry) {
            const previousMemory = this.bufferPool.combined?.buffer;
            let id = 0;
            try {
                id = this.dspBinding.createInstance(plugin.type);
            } finally {
                const currentMemory = this.dspBinding.memory?.buffer;
                if (currentMemory && previousMemory !== currentMemory) {
                    this.adoptDspArena();
                }
            }
            if (!id) {
                this.reportDspFailure(`instance:${plugin.id}`, `unable to create ${plugin.type}`);
                return;
            }
            entry = { id, type: plugin.type, ready: false };
            this.wasmInstances.set(plugin.id, entry);
            const tapStatus = this.dspBinding.instanceSetTap(id, plugin.id >>> 0);
            if (tapStatus !== 0) {
                this.reportDspFailure(`instance:${plugin.id}`, `tap binding returned ${tapStatus}`);
            }
        }

        if (plugin.wasmParams instanceof Float32Array && (plugin.wasmParamsHash >>> 0) === kernel.paramsHash) {
            const numericStatus = this.dspBinding.instanceSetParams(
                entry.id,
                plugin.wasmParams,
                plugin.wasmParamsHash >>> 0
            );
            let byteStatus = 0;
            if (numericStatus === 0 && kernel.byteCapacity > 0) {
                if (!(plugin.wasmParamBytes instanceof Uint8Array) ||
                    plugin.wasmParamBytes.byteLength > kernel.byteCapacity) {
                    byteStatus = ET_DSP_ERR_ARGS;
                } else {
                    byteStatus = this.dspBinding.instanceSetParamBytes(
                        entry.id,
                        plugin.wasmParamBytes,
                        plugin.wasmParamsHash >>> 0
                    );
                }
            }
            entry.ready = numericStatus === 0 && byteStatus === 0;
            if (numericStatus !== 0) {
                this.reportDspFailure(
                    `instance:${plugin.id}`,
                    `set_params returned ${numericStatus}`
                );
            } else if (byteStatus !== 0) {
                this.reportDspFailure(
                    `instance:${plugin.id}`,
                    `set_param_bytes returned ${byteStatus}`
                );
            }
        } else {
            entry.ready = false;
        }
    }

    refreshDspPipeline() {
        this.dspPipelineReady = false;
        if (!this.dspLive || !this.dspBinding) {
            this.publishDspPipelineLatency(0);
            return;
        }

        this.updateDspPipelineLatency();

        const nodes = [];
        let insideSection = false;
        let sectionEnabled = true;
        for (const plugin of this.plugins) {
            if (plugin.type === 'SectionPlugin') {
                insideSection = true;
                sectionEnabled = Boolean(plugin.enabled);
                continue;
            }
            if (!plugin.enabled || (insideSection && !sectionEnabled)) continue;

            const entry = this.wasmInstances.get(plugin.id);
            if (!entry?.ready) return;
            nodes.push({
                instanceId: entry.id,
                inputBus: plugin.inputBus,
                outputBus: plugin.outputBus,
                channel: plugin.channel
            });
        }

        try {
            const status = this.dspBinding.pipelineConfigure(encodeWorkletDspPipeline(nodes));
            if (status !== 0) {
                this.reportDspFailure('pipeline-configure', `status ${status}`);
                return;
            }
            this.dspPipelineReady = true;
        } catch (error) {
            this.reportDspFailure('pipeline-configure', error?.message || String(error));
        }
    }

    publishDspPipelineLatency(samples) {
        const normalized = Number.isInteger(samples) && samples > 0 ? samples : 0;
        if (normalized === this.dspPipelineLatencySamples) return;
        this.dspPipelineLatencySamples = normalized;
        this.port.postMessage({
            type: 'dspLatency',
            samples: normalized,
            sampleRate: this.dspSampleRate || globalThis.sampleRate,
            compensated: false
        });
    }

    updateDspPipelineLatency() {
        const busLatency = [0, 0, 0, 0, 0];
        let insideSection = false;
        let sectionEnabled = true;
        for (const plugin of this.plugins) {
            if (plugin.type === 'SectionPlugin') {
                insideSection = true;
                sectionEnabled = Boolean(plugin.enabled);
                continue;
            }
            if (!plugin.enabled || (insideSection && !sectionEnabled)) continue;

            const inputBus = plugin.inputBus;
            const outputBus = plugin.outputBus;
            if (!Number.isInteger(inputBus) || inputBus < 0 || inputBus >= busLatency.length ||
                !Number.isInteger(outputBus) || outputBus < 0 || outputBus >= busLatency.length) {
                continue;
            }
            const entry = this.wasmInstances.get(plugin.id);
            let pluginLatency = 0;
            if (entry?.ready) {
                try {
                    pluginLatency = this.dspBinding.instanceLatency(entry.id) >>> 0;
                } catch (error) {
                    this.reportDspFailure(`latency:${plugin.id}`, error?.message || String(error));
                }
            }
            const routedLatency = busLatency[inputBus] + pluginLatency;
            if (inputBus === outputBus || routedLatency > busLatency[outputBus]) {
                busLatency[outputBus] = routedLatency;
            }
        }
        this.publishDspPipelineLatency(busLatency[0]);
    }

    restoreDspPipelineInput(combinedBuffer, totalSize, input, channelCount, frameCount) {
        combinedBuffer.fill(0, 0, totalSize);
        const channelsToCopy = input.length < channelCount ? input.length : channelCount;
        for (let channel = 0; channel < channelsToCopy; channel++) {
            const source = input[channel];
            const offset = channel * frameCount;
            for (let frame = 0; frame < frameCount; frame++) {
                combinedBuffer[offset + frame] = source[frame];
            }
        }
    }

    snapshotDspHybridInput(processingBuffer, sampleCount) {
        for (let index = 0; index < sampleCount; index++) {
            this.dspHybridInputBackup[index] = processingBuffer[index];
        }
    }

    restoreDspHybridInput(processingBuffer, sampleCount) {
        for (let index = 0; index < sampleCount; index++) {
            processingBuffer[index] = this.dspHybridInputBackup[index];
        }
    }

    isDspArenaViewCurrent(view, expectedMemory, sampleCount) {
        if (!this.dspLive || !view || view.byteLength < sampleCount * Float32Array.BYTES_PER_ELEMENT) {
            return false;
        }
        if (!expectedMemory) return true;
        return this.dspBinding?.memory?.buffer === expectedMemory && view.buffer === expectedMemory;
    }

    bypassCurrentBlock(input, output, outputChannelCount, frameCount) {
        const channelsToWrite = output.length < outputChannelCount ? output.length : outputChannelCount;
        for (let channel = 0; channel < output.length; channel++) {
            const target = output[channel];
            if (channel < channelsToWrite && channel < input.length) {
                const source = input[channel];
                for (let frame = 0; frame < frameCount; frame++) {
                    target[frame] = source[frame];
                }
            } else {
                target.fill(0);
            }
        }
    }

    tryDspPipeline(combinedBuffer, totalSize, input, channelCount, frameCount, time) {
        if (!this.dspPipelineReady || !this.dspLive || channelCount > ET_DSP_MAX_CHANNELS ||
            frameCount !== ET_DSP_MAX_FRAMES) {
            return ET_DSP_PIPELINE_FALLBACK;
        }

        const expectedMemory = this.dspBinding.memory?.buffer;
        if (!this.isDspArenaViewCurrent(combinedBuffer, expectedMemory, totalSize)) {
            if (this.dspLive) this.failDspEngine('runtime', 'arena invalid before pipeline processing');
            return ET_DSP_PIPELINE_ARENA_INVALID;
        }

        let status = 0;
        let processError = null;
        try {
            status = this.dspBinding.pipelineProcess(channelCount, frameCount, time, false);
        } catch (error) {
            processError = error;
        }

        if (!this.isDspArenaViewCurrent(combinedBuffer, expectedMemory, totalSize)) {
            if (this.dspLive) this.failDspEngine('runtime', 'arena invalid during pipeline processing');
            return ET_DSP_PIPELINE_ARENA_INVALID;
        }
        if (status === 0 && !processError) {
            this.recordDspProcessing('singleCallBlocks');
            return ET_DSP_PIPELINE_PROCESSED;
        }

        this.restoreDspPipelineInput(combinedBuffer, totalSize, input, channelCount, frameCount);
        this.dspPipelineReady = false;
        if (processError) {
            this.reportDspFailure('pipeline-process', processError?.message || String(processError));
        } else {
            this.reportDspFailure('pipeline-process', `status ${status}`);
        }
        return ET_DSP_PIPELINE_FALLBACK;
    }

    recordDspProcessing(counter) {
        if (!this.dspBenchEnabled) return;
        this.dspStats[counter]++;
        const processedOperations = this.dspStats.singleCallBlocks + this.dspStats.hybridInstanceCalls;
        if (processedOperations !== 1 && processedOperations - this.dspStats.lastPublishedOperations < 4096) return;
        this.dspStats.lastPublishedOperations = processedOperations;
        this.port.postMessage({
            type: 'dspStats',
            singleCallBlocks: this.dspStats.singleCallBlocks,
            hybridInstanceCalls: this.dspStats.hybridInstanceCalls,
            telemetryDroppedFrames: this.dspStats.telemetryDroppedFrames,
            pipelineReady: this.dspPipelineReady,
            readyInstances: Array.from(this.wasmInstances.values()).filter(entry => entry.ready).length,
            simd: this.dspSimd
        });
    }

    finishDspPipelineBlock(output, combinedBuffer, outputChannelCount, blockSize, sampleRate, time) {
        let insideSection = false;
        let sectionEnabled = true;
        for (const plugin of this.plugins) {
            if (plugin.type === 'SectionPlugin') {
                insideSection = true;
                sectionEnabled = Boolean(plugin.enabled);
                continue;
            }
            if (!plugin.enabled || (insideSection && !sectionEnabled)) continue;
            let context = this.pluginContexts.get(plugin.id);
            if (!context) {
                context = {};
                this.pluginContexts.set(plugin.id, context);
            }
            if (context.reportedSampleRate !== sampleRate) {
                context.reportedSampleRate = sampleRate;
                this.port.postMessage({ pluginId: plugin.id, sampleRate });
            }
        }

        const channelsToWrite = output.length < outputChannelCount ? output.length : outputChannelCount;
        for (let channel = 0; channel < output.length; channel++) output[channel].fill(0);
        for (let channel = 0; channel < channelsToWrite; channel++) {
            const offset = channel * blockSize;
            const target = output[channel];
            for (let frame = 0; frame < blockSize; frame++) {
                target[frame] = combinedBuffer[offset + frame];
            }
        }

        const threshold = 2 * this.audioLevelMonitoring._silenceThresholdAmplitude;
        let hasOutputSignal = false;
        for (let channel = 0; channel < channelsToWrite && !hasOutputSignal; channel++) {
            const data = output[channel];
            let minimum = Infinity;
            let maximum = -Infinity;
            for (let index = 0; index < data.length; index++) {
                const value = data[index];
                if (value < minimum) minimum = value;
                if (value > maximum) maximum = value;
                if (maximum - minimum > threshold) {
                    hasOutputSignal = true;
                    break;
                }
            }
        }
        if (hasOutputSignal) this.audioLevelMonitoring.lastOutputActiveTime = time;
        this.pumpDspTelemetry();
    }

    runtimeFallback(plugin, error, stage = 'runtime') {
        this.dspPipelineReady = false;
        const entry = this.wasmInstances.get(plugin.id);
        if (entry) {
            entry.ready = false;
            this.wasmInstances.delete(plugin.id);
            this.dspPendingInstanceDestroy.push(entry.id);
        }
        const failures = (this.dspRuntimeFailures.get(plugin.type) || 0) + 1;
        this.dspRuntimeFailures.set(plugin.type, failures);
        this.reportDspFailure(`${stage}:${plugin.id}`, error);
        if (failures >= 3) {
            this.dspFailedTypes.add(plugin.type);
            this.dspEnabledTypes.delete(plugin.type);
            for (const candidate of this.plugins) {
                if (candidate.type !== plugin.type) continue;
                const candidateEntry = this.wasmInstances.get(candidate.id);
                if (candidateEntry) {
                    candidateEntry.ready = false;
                    this.wasmInstances.delete(candidate.id);
                    this.dspPendingInstanceDestroy.push(candidateEntry.id);
                }
            }
        }
        this.port.postMessage({ type: 'dspCleanupNeeded' });
    }

    pumpDspTelemetry() {
        if (!this.dspLive || this.dspPacketPool.length === 0) return;
        const packetView = this.dspPacketPool.pop();
        try {
            const bytes = this.dspBinding.telemetryRead(packetView);
            if (this.dspBenchEnabled) {
                this.dspStats.telemetryDroppedFrames += this.dspBinding.lastTelemetryDroppedFrames >>> 0;
            }
            if (bytes > 0) {
                const packet = packetView.buffer;
                this.port.postMessage({
                    type: 'dspTelemetry',
                    packet,
                    bytes,
                    droppedFrames: this.dspBinding.lastTelemetryDroppedFrames >>> 0
                }, [packet]);
            } else {
                this.dspPacketPool.push(packetView);
            }
        } catch (error) {
            this.dspPacketPool.push(packetView);
            this.failDspEngine('runtime', error?.message || String(error));
        }
    }

    registerPluginProcessor(pluginType, processorFunction) {
        try {
            // Compile function once during registration
            const compiledFunction = new Function('context', 'data', 'parameters', 'time',
                // Use strict mode for potentially better optimization and error checking
                `'use strict';
                 // Avoid 'with' statement as it's deprecated and hurts performance/optimization
                 // Instead, necessary context properties should be explicitly passed or accessed.
                 // Assuming 'context' holds necessary methods/properties directly.
                 try {
                     // The processor function string is directly embedded here
                     ${processorFunction}
                     // Ensure the function returns the processed data or modifies it in place
                     return data; // Or return modified data if the plugin creates a new buffer
                 } catch (error) {
                     console.error('Error in processor function (${pluginType}):', error);
                     // Return original data on error to prevent chain breakage
                     return data;
                 }`
            );
            this.pluginProcessors.set(pluginType, compiledFunction);
            this.processorRegistrationErrors.delete(pluginType);
            this.reportedMissingProcessors.delete(pluginType);
            // console.log(`Registered processor for type: ${pluginType}`);
        } catch (error) {
             console.error(`Failed to compile processor function for ${pluginType}:`, error);
             this.pluginProcessors.delete(pluginType);
             this.processorRegistrationErrors.add(pluginType);
        }
    }

    normalizePluginConfig(pluginConfig) {
        const params = pluginConfig?.parameters ?? {};
        return {
            ...pluginConfig,
            inputBus: params.inputBus ?? pluginConfig?.inputBus ?? 0,
            outputBus: params.outputBus ?? pluginConfig?.outputBus ?? 0,
            channel: params.channel ?? pluginConfig?.channel ?? null,
        };
    }

    updatePlugin(pluginConfig) {
        if (!pluginConfig) return;
        const index = this.plugins.findIndex(p => p.id === pluginConfig.id);
        if (index !== -1) {
            const normalizedPlugin = this.normalizePluginConfig(pluginConfig);
            this.dspPipelineReady = false;
            try {
                this.plugins[index] = normalizedPlugin;
                this.reconcileDspPluginSafely(normalizedPlugin);
            } finally {
                this.refreshDspPipeline();
            }

            // console.log(`Updated plugin: ${pluginConfig.id}`);
        } else {
            // console.warn(`Plugin with id ${pluginConfig.id} not found for updating.`);
            // Optionally add the plugin if it's meant to be dynamic
            // this.plugins.push(pluginConfig);
            // this.updatePlugin(pluginConfig); // Re-run to normalize properties
        }
    }

    updatePlugins(pluginConfigs) {
        const normalizedPlugins = pluginConfigs.map(p => this.normalizePluginConfig(p));
        this.dspPipelineReady = false;
        try {
            this.plugins = normalizedPlugins;
            this.reconcileDspInstances();
        } finally {
            this.refreshDspPipeline();
        }
        // Clear contexts for plugins that might have been removed?
        // Or handle context cleanup based on removed IDs.
        // For simplicity, we keep existing contexts; they won't be used if plugin is gone.
        // console.log(`Updated plugin chain (${this.plugins.length} plugins)`);
    }

    batchUpdatePlugins(pluginConfigs) {
        for (const pluginConfig of pluginConfigs) {
            this.updatePlugin(pluginConfig);
        }
    }

    addPlugin(pluginConfig, index) {
        if (!pluginConfig) return;
        const normalizedPlugin = this.normalizePluginConfig(pluginConfig);
        const existingIndex = this.plugins.findIndex(p => p.id === normalizedPlugin.id);
        this.dspPipelineReady = false;
        if (existingIndex !== -1) {
            try {
                this.plugins[existingIndex] = normalizedPlugin;
                this.reconcileDspPluginSafely(normalizedPlugin);
            } finally {
                this.refreshDspPipeline();
            }
            return;
        }

        const insertIndex = Number.isInteger(index)
            ? (index < 0 ? 0 : (index > this.plugins.length ? this.plugins.length : index))
            : this.plugins.length;
        try {
            this.plugins.splice(insertIndex, 0, normalizedPlugin);
            this.reconcileDspPluginSafely(normalizedPlugin);
        } finally {
            this.refreshDspPipeline();
        }
    }

    removePlugin(pluginId) {
        const index = this.plugins.findIndex(p => p.id === pluginId);
        if (index === -1) return;
        this.dspPipelineReady = false;
        try {
            this.plugins.splice(index, 1);
            this.pluginContexts.delete(pluginId);
            try {
                this.destroyDspInstance(pluginId);
            } catch (error) {
                this.failDspEngine('reconcile', error?.message || String(error));
            }
        } finally {
            this.refreshDspPipeline();
        }
    }

    reorderPlugin(fromIndex, toIndex) {
        if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) return;
        if (fromIndex < 0 || fromIndex >= this.plugins.length) return;
        const targetIndex = toIndex < 0 ? 0 : (toIndex >= this.plugins.length ? this.plugins.length - 1 : toIndex);
        this.dspPipelineReady = false;
        try {
            const [plugin] = this.plugins.splice(fromIndex, 1);
            this.plugins.splice(targetIndex, 0, plugin);
        } finally {
            this.refreshDspPipeline();
        }
    }

    // Optimized process method
    process(inputs, outputs, parameters) {
        const input = inputs[0];
        const output = outputs[0];

        // --- 1. Basic Checks & Early Exit ---
        // Check if input/output streams exist and have data
        if (!input || !output || !input[0] || input[0].length === 0) {
            // If input is invalid/empty, zero out output to ensure silence and return.
            if (output && output.length > 0) {
                for (let i = 0; i < output.length; i++) {
                    // Ensure channel exists before filling
                    output[i]?.fill(0);
                }
            }
            // Keep processor alive, even with no input, as input might appear later.
            return true;
        }

        // --- 2. Cache Frequently Accessed Properties & State ---
        const blockSize = input[0].length; // Critical: Block size from actual input buffer
        const currentFrame = this.currentFrame;
        const sampleRate = globalThis.sampleRate; // Standard way to get sample rate in AudioWorklet
        const audioLevelMonitoring = this.audioLevelMonitoring;
        const plugins = this.plugins; // Array of plugin configurations
        const pluginProcessors = this.pluginProcessors; // Map of compiled processor functions
        const pluginContexts = this.pluginContexts; // Map for plugin state/context
        const port = this.port; // For messaging back to the main thread
        const masterBypass = this.masterBypass;
        let isSleepMode = audioLevelMonitoring.isSleepMode; // Cache current sleep state
        // Get configured output channels, default to 2 if not set
        const outputChannelCount = this.outputChannelCount;
        // Use the cached amplitude threshold
        const silenceThresholdAmplitude = audioLevelMonitoring._silenceThresholdAmplitude;

        if (this.dspLive) {
            if (this.dspBinding.checkMemoryBuffer()) {
                this.failDspEngine('runtime', 'memory.buffer identity changed');
            }
        }


        // --- 3. Calculate Current Time ---
        const time = currentFrame / sampleRate; // Time in seconds

        // --- 4. Input Level Monitoring & Sleep Mode Update ---
        // We treat a channel as silent only if its AC component (peak-to-peak
        // range with the DC offset removed) is below 2 * threshold. This
        // matters because some plugins (e.g. Exciter with a non-zero bias)
        // emit a constant DC component for a silent input, which would
        // otherwise be classified as "signal" and forever prevent sleep mode.
        let hasInputSignal = false;
        const inputChannelsToCheck = Math.min(input.length, outputChannelCount);
        const acThreshold = 2 * silenceThresholdAmplitude;
        for (let channel = 0; channel < inputChannelsToCheck; channel++) {
            const channelData = input[channel];
            let cmin = Infinity, cmax = -Infinity;
            for (let i = 0; i < channelData.length; i++) {
                const v = channelData[i];
                if (v < cmin) cmin = v;
                if (v > cmax) cmax = v;
                if (cmax - cmin > acThreshold) break; // early exit
            }
            if (cmax - cmin > acThreshold) {
                hasInputSignal = true;
                break;
            }
        }

        if (hasInputSignal) {
            audioLevelMonitoring.lastInputActiveTime = time;
            if (isSleepMode) {
                // Exit sleep mode if needed
                isSleepMode = false;
                audioLevelMonitoring.isSleepMode = false;
                port.postMessage({ type: 'sleepModeChanged', isSleepMode: false });
                 console.log(`Input signal detected at ${time}s, exiting sleep mode.`);
            }
        } else {
            // Only check for entering sleep mode if currently NOT sleeping
            if (!isSleepMode) {
                const inputSilenceDuration = time - audioLevelMonitoring.lastInputActiveTime;
                const outputSilenceDuration = time - audioLevelMonitoring.lastOutputActiveTime;
                // Initialize lastUserActivityTime on the first run if it hasn't been set
                if (audioLevelMonitoring.lastUserActivityTime === 0) {
                    audioLevelMonitoring.lastUserActivityTime = time;
                }
                const userInactivityDuration = time - audioLevelMonitoring.lastUserActivityTime;
                const silenceDurationThreshold = audioLevelMonitoring.SILENCE_DURATION;

                // Check if all conditions for sleep are met
                if (inputSilenceDuration >= silenceDurationThreshold &&
                    outputSilenceDuration >= silenceDurationThreshold &&
                    userInactivityDuration >= silenceDurationThreshold)
                {
                    isSleepMode = true;
                    audioLevelMonitoring.isSleepMode = true;
                    port.postMessage({ type: 'sleepModeChanged', isSleepMode: true });
                    console.log(`Entering sleep mode at ${time}s due to inactivity.`);
                }
            }
        }

        // --- 5. Master Bypass or Sleep Mode Handling ---
        if (masterBypass || isSleepMode) {
            const numInputChannels = input.length;
            const numOutputChannels = output.length;
            const channelsToCopy = Math.min(numInputChannels, numOutputChannels);

            // Copy input to output efficiently for matching channels
            for (let channel = 0; channel < channelsToCopy; channel++) {
                // Use Float32Array.prototype.set for fast block copy
                output[channel].set(input[channel]);
            }
            // Zero out any remaining output channels if output has more channels than input
            for (let channel = channelsToCopy; channel < numOutputChannels; channel++) {
                 output[channel].fill(0);
            }

            // IMPORTANT: Still need to advance the frame counter even when bypassed/sleeping
            this.currentFrame += blockSize;
            return true; // Keep processor alive
        }

        // --- 6. Update Processor State ---
        // this.blockSize = blockSize; // Update instance property if it's used elsewhere
        this.currentFrame += blockSize; // Advance frame counter


        // --- 7. Prepare Combined Multichannel Buffer (Optimized with Buffer Pool) ---
        const totalSize = blockSize * outputChannelCount;
        let combinedBuffer;
        
        // Use pre-allocated buffer pool for better performance
        if (outputChannelCount <= 8 && blockSize === 128) {
            // Use pre-allocated buffer from pool
            combinedBuffer = this.bufferPool.combined;
            // Zero out only the portion we'll use
            combinedBuffer.fill(0, 0, totalSize);
        } else {
            // Fallback to dynamic allocation for non-standard sizes
            if (!this.combinedBuffer || this.combinedBuffer.length !== totalSize) {
                this.combinedBuffer = new Float32Array(totalSize);
                console.log(`Reallocated combinedBuffer: ${outputChannelCount} channels, size ${totalSize}`);
            }
            combinedBuffer = this.combinedBuffer;
        }

        // Copy input data to the combined buffer. Channels beyond the configured
        // output width are intentionally dropped; missing channels remain silent.
        const inputChannelsToUse = Math.min(input.length, outputChannelCount);
        for (let i = 0; i < inputChannelsToUse; i++) {
            combinedBuffer.set(input[i], i * blockSize);
        }
        // Zero out remaining channels in the combined buffer if necessary
        if (outputChannelCount > inputChannelsToUse) {
            for (let i = inputChannelsToUse; i < outputChannelCount; i++) {
                // Calculate start and end indices for fill
                const offset = i * blockSize;
                // Use fill for efficiency
                combinedBuffer.fill(0, offset, offset + blockSize);
            }
        }

        const dspPipelineResult = this.tryDspPipeline(
            combinedBuffer,
            totalSize,
            input,
            outputChannelCount,
            blockSize,
            time
        );
        if (dspPipelineResult === ET_DSP_PIPELINE_PROCESSED) {
            this.finishDspPipelineBlock(
                output,
                combinedBuffer,
                outputChannelCount,
                blockSize,
                sampleRate,
                time
            );
            return true;
        }
        if (dspPipelineResult === ET_DSP_PIPELINE_ARENA_INVALID) {
            this.bypassCurrentBlock(input, output, outputChannelCount, blockSize);
            return true;
        }


        // --- 8. Bus Buffer Management ---
        const busBuffers = this.busBuffers; // Local reference
        busBuffers.clear(); // Clear previous buffers

        // Determine which buses are actively used by enabled plugins
        const usedBuses = new Set([0]); // Main bus (0) is implicitly used for input/output
        let activeSectionEnabled = true; // Tracks if the current section is active
        let insideSection = false; // Tracks if currently inside a section definition

        for (const plugin of plugins) {
            // Handle section start/end markers
            if (plugin.type === 'SectionPlugin') {
                insideSection = true;
                activeSectionEnabled = plugin.enabled; // Section is active if the plugin is enabled
                continue; // Section plugins don't process audio or use buses
            }

            // Skip processing logic for disabled plugins or plugins within a disabled section
            if (!plugin.enabled || (insideSection && !activeSectionEnabled)) {
                continue;
            }

            // Add the input and output buses of this active plugin to the set
            // Access normalized properties directly
            usedBuses.add(plugin.inputBus);
            usedBuses.add(plugin.outputBus);
        }

        // Set the main bus (0) buffer to our prepared combinedBuffer
        busBuffers.set(0, combinedBuffer);

        // Allocate and zero-fill buffers for other used buses (Optimized with Buffer Pool)
        for (const busIndex of usedBuses) {
            if (busIndex !== 0) {
                let busBuffer;
                
                // Use pre-allocated buffer from pool if available
                if (outputChannelCount <= 8 && blockSize === 128 && this.bufferPool.buses.has(busIndex)) {
                    busBuffer = this.bufferPool.buses.get(busIndex);
                    // Zero out only the portion we'll use
                    busBuffer.fill(0, 0, totalSize);
                } else {
                    // Fallback to dynamic allocation for non-standard sizes or bus indices
                    busBuffer = new Float32Array(totalSize);
                }
                
                busBuffers.set(busIndex, busBuffer);
            }
        }

        // --- 9. Process Audio Through Plugins ---
        // Reset section state for the processing loop
        activeSectionEnabled = true;
        insideSection = false;
        let lastMessageTime = this.lastMessageTime; // Cache for message throttling
        const messageQueue = this.messageQueue; // Cache message queue
        const MESSAGE_INTERVAL = this.MESSAGE_INTERVAL; // Cache interval

        for (const plugin of plugins) {
            // Handle section start/end
            if (plugin.type === 'SectionPlugin') {
                insideSection = true;
                activeSectionEnabled = plugin.enabled;
                continue;
            }

            // Skip disabled or section-disabled plugins
            if (!plugin.enabled || (insideSection && !activeSectionEnabled)) {
                continue;
            }

            // Get the compiled processor function for this plugin type
            const processor = pluginProcessors.get(plugin.type);
            const wasmEntry = this.dspLive ? this.wasmInstances.get(plugin.id) : null;
            if (!processor && !wasmEntry?.ready) {
                if (!this.reportedMissingProcessors.has(plugin.type)) {
                    this.reportedMissingProcessors.add(plugin.type);
                    console.warn(`Processor function not found for type: ${plugin.type}`);
                    port.postMessage({
                        type: 'processorMissing',
                        pluginId: plugin.id,
                        pluginType: plugin.type
                    });
                }
                for (let ch = 0; ch < output.length; ch++) {
                    output[ch].fill(0);
                }
                this.lastMessageTime = lastMessageTime;
                return true;
            }

            // Get or initialize plugin state/context
            let pluginContext = pluginContexts.get(plugin.id);
            if (!pluginContext) {
                pluginContext = {}; // Initialize empty context
                pluginContexts.set(plugin.id, pluginContext);
            }
            if (pluginContext.reportedSampleRate !== sampleRate) {
                pluginContext.reportedSampleRate = sampleRate;
                port.postMessage({ pluginId: plugin.id, sampleRate });
            }
            // Determine input and output buses for this plugin
            const inputBus = plugin.inputBus; // Use normalized property
            const outputBus = plugin.outputBus; // Use normalized property

            // Get the corresponding buffers
            const inputBuffer = busBuffers.get(inputBus);
            const outputBuffer = busBuffers.get(outputBus);

            // Skip if buses are invalid (should not happen if usedBuses logic is correct)
            if (!inputBuffer || !outputBuffer) {
                 console.error(`Invalid bus index for plugin ${plugin.id}: inputBus=${inputBus}, outputBus=${outputBus}`);
                 continue;
            }

            // --- 9a. Channel Processing Logic ---
            const targetChannelSpec = plugin.channel; // Use normalized property (null, "A", "L", "R", "34", etc.)
            let processingBuffer; // The buffer data passed TO the plugin processor
            let resultTargetBuffer; // The buffer where the result should ultimately be written (usually outputBuffer)
            let numProcessingChannels = 0; // How many channels the plugin processor function expects
            let tempBuffer;       // Temporary buffer if needed for isolation/copying
            let processMode = 'skip'; // 'all', 'pair', 'single', 'skip'
            let pairStartChannel = -1; // Starting channel index (0-based) for pairs
            let singleChannelIndex = -1;// Channel index (0-based) for single channel

            // Determine processing mode based on targetChannelSpec
            switch (targetChannelSpec) {
                case 'A': // Process all available channels
                    if (outputChannelCount > 0) {
                        processMode = 'all';
                        numProcessingChannels = outputChannelCount;
                    }
                    break;
                case 'L': // Process Left channel (index 0)
                    if (outputChannelCount > 0) {
                        processMode = 'single';
                        singleChannelIndex = 0;
                        numProcessingChannels = 1;
                    }
                    break;
                case 'R': // Process Right channel (index 1)
                    if (outputChannelCount > 1) {
                        processMode = 'single';
                        singleChannelIndex = 1;
                        numProcessingChannels = 1;
                    }
                    break;
                case null: // Default: process stereo pair (channels 0, 1)
                case undefined:
                    if (outputChannelCount >= 2) {
                        processMode = 'pair';
                        pairStartChannel = 0;
                        numProcessingChannels = 2;
                    }
                    break;
                case '34': // Process pair (channels 2, 3)
                    if (outputChannelCount >= 4) {
                        processMode = 'pair';
                        pairStartChannel = 2;
                        numProcessingChannels = 2;
                    }
                    break;
                case '56': // Process pair (channels 4, 5)
                     if (outputChannelCount >= 6) {
                        processMode = 'pair';
                        pairStartChannel = 4;
                        numProcessingChannels = 2;
                    }
                    break;
                 case '78': // Process pair (channels 6, 7)
                     if (outputChannelCount >= 8) {
                        processMode = 'pair';
                        pairStartChannel = 6;
                        numProcessingChannels = 2;
                    }
                    break;
                default:
                    // Check for specific numeric channel (e.g., "3")
                    const parsedChannel = parseInt(targetChannelSpec, 10);
                    if (!isNaN(parsedChannel) && parsedChannel > 0 && parsedChannel <= outputChannelCount) {
                        processMode = 'single';
                        singleChannelIndex = parsedChannel - 1; // Convert to 0-based index
                        numProcessingChannels = 1;
                    } else {
                        console.warn(`Invalid channel specifier "${targetChannelSpec}" for plugin ${plugin.id}`);
                    }
                    break;
            }

            if (processMode === 'skip') continue; // Skip plugin if channel spec is invalid for current config

            // --- 9b. Prepare Buffers for Plugin Execution ---
             const requiresCopy = (inputBus !== outputBus) || (processMode === 'pair') || (processMode === 'single');

            if (processMode === 'all') {
                if (requiresCopy) {
                    // Use Buffer Pool for all-channel processing when possible (Optimized)
                    if (outputChannelCount <= 8 && blockSize === 128) {
                        // Use pre-allocated buffer from pool
                        tempBuffer = this.bufferPool.allChannels;
                        const totalSize = blockSize * outputChannelCount;
                        // Copy input data to the buffer
                        tempBuffer.set(inputBuffer.subarray(0, totalSize));
                    } else {
                        // Fallback to dynamic allocation for non-standard sizes
                        tempBuffer = new Float32Array(inputBuffer); // Full copy
                    }
                    processingBuffer = tempBuffer;
                } else {
                    // Process directly in the input/output buffer (which are the same)
                    processingBuffer = inputBuffer; // Reference, no copy
                }
                resultTargetBuffer = outputBuffer; // Result goes directly to the output bus buffer
            } else if (processMode === 'pair') {
                // Use pre-allocated stereo buffer for pair processing (Optimized)
                if (blockSize === 128) {
                    tempBuffer = this.bufferPool.stereo;
                    // Zero out the buffer before use
                    tempBuffer.fill(0);
                } else {
                    // Fallback for non-standard block sizes
                    const stereoSize = blockSize * 2;
                    tempBuffer = new Float32Array(stereoSize);
                }
                // Copy the selected pair from inputBuffer to the temporary stereo buffer efficiently
                tempBuffer.set(inputBuffer.subarray(pairStartChannel * blockSize, (pairStartChannel + 1) * blockSize), 0); // Ch 1
                tempBuffer.set(inputBuffer.subarray((pairStartChannel + 1) * blockSize, (pairStartChannel + 2) * blockSize), blockSize); // Ch 2
                processingBuffer = tempBuffer; // Plugin processes this temp buffer
                // Result will be written back from tempBuffer to the correct place in outputBuffer later
            } else if (processMode === 'single') {
                // Use pre-allocated mono buffer for single channel processing (Optimized)
                if (blockSize === 128) {
                    tempBuffer = this.bufferPool.mono;
                    // Zero out the buffer before use
                    tempBuffer.fill(0);
                } else {
                    // Fallback for non-standard block sizes
                    tempBuffer = new Float32Array(blockSize);
                }
                // Copy the selected channel from inputBuffer to the temporary mono buffer
                tempBuffer.set(inputBuffer.subarray(singleChannelIndex * blockSize, (singleChannelIndex + 1) * blockSize));
                processingBuffer = tempBuffer; // Plugin processes this temp buffer
                 // Result will be written back from tempBuffer later
            }

            // --- 9d. Execute Plugin Processor Function ---
            let result = processingBuffer;
            let processedInWasm = false;
            if (wasmEntry?.ready && this.dspLive &&
                outputChannelCount <= ET_DSP_MAX_CHANNELS && blockSize === ET_DSP_MAX_FRAMES) {
                const sampleCount = numProcessingChannels * blockSize;
                const expectedMemory = this.dspBinding.memory?.buffer;
                if (!this.isDspArenaViewCurrent(processingBuffer, expectedMemory, sampleCount)) {
                    if (this.dspLive) this.failDspEngine('runtime', 'arena invalid before instance processing');
                    this.bypassCurrentBlock(input, output, outputChannelCount, blockSize);
                    return true;
                }
                const audioPtr = this.dspBinding.pointerForArenaView(processingBuffer);
                if (audioPtr !== null) {
                    this.snapshotDspHybridInput(processingBuffer, sampleCount);
                    let status = 0;
                    let processError = null;
                    try {
                        status = this.dspBinding.instanceProcess(
                            wasmEntry.id,
                            audioPtr,
                            numProcessingChannels,
                            blockSize,
                            time
                        );
                    } catch (error) {
                        processError = error;
                    }
                    if (!this.isDspArenaViewCurrent(processingBuffer, expectedMemory, sampleCount)) {
                        if (this.dspLive) this.failDspEngine('runtime', 'arena invalid during instance processing');
                        this.bypassCurrentBlock(input, output, outputChannelCount, blockSize);
                        return true;
                    }
                    if (status === 0 && !processError) {
                        processedInWasm = true;
                        this.recordDspProcessing('hybridInstanceCalls');
                    } else {
                        this.restoreDspHybridInput(processingBuffer, sampleCount);
                        this.runtimeFallback(
                            plugin,
                            processError ? (processError?.message || String(processError)) : `process returned ${status}`
                        );
                    }
                }
            }

            if (!processedInWasm && processor) {
                // Preserve legacy clone-and-store semantics only when JavaScript runs.
                const context = { ...pluginContext, port };
                const processingParams = {
                    ...(plugin.parameters ?? {}),
                    id: plugin.id,
                    channelCount: numProcessingChannels,
                    blockSize,
                    sampleRate
                };
                try {
                    result = processor.call(context, context, processingBuffer, processingParams, time);
                    pluginContexts.set(plugin.id, context);
                } catch(e) {
                    console.error(`Error executing plugin ${plugin.id} (${plugin.type}):`, e);
                    result = processingBuffer;
                }
            }


             // Determine the actual buffer containing the processed result
             // Plugins might modify `processingBuffer` in-place or return a new buffer instance.
             // Assume modification in-place unless result is a Float32Array.
             const finalResultBuffer = (result instanceof Float32Array) ? result : processingBuffer;

             if (!finalResultBuffer) continue; // Skip if result is invalid

             // --- 9e. Apply Result to Output Bus Buffer ---
             if (inputBus !== outputBus) {
                 // Additive mixing: Add the processed result to the output buffer
                 if (processMode === 'all') {
                     // Optimized: Use dedicated mixing buffer for better performance
                     // Avoid read/write overlap issues with separate mixing buffer
                     if (outputChannelCount <= 8 && blockSize === 128) {
                         // Use dedicated pre-allocated mixing buffer from pool
                         const mixBuffer = this.bufferPool.mixing;
                         // Copy current output state to mixing buffer
                         mixBuffer.set(outputBuffer.subarray(0, totalSize));
                         // Add the processed result using optimized loop
                         for (let i = 0; i < totalSize; i++) {
                             mixBuffer[i] += finalResultBuffer[i];
                         }
                         // Copy mixed result back to output buffer
                         outputBuffer.set(mixBuffer.subarray(0, totalSize));
                     } else {
                         // Fallback for non-standard sizes - direct addition
                         for (let i = 0; i < totalSize; i++) {
                             outputBuffer[i] += finalResultBuffer[i];
                         }
                     }
                 } else if (processMode === 'pair') {
                     const offset1 = pairStartChannel * blockSize;
                     const offset2 = (pairStartChannel + 1) * blockSize;
                     // Optimized: Use subarray views and set() for channel processing
                     const ch1Output = outputBuffer.subarray(offset1, offset1 + blockSize);
                     const ch2Output = outputBuffer.subarray(offset2, offset2 + blockSize);
                     const ch1Input = finalResultBuffer.subarray(0, blockSize);
                     const ch2Input = finalResultBuffer.subarray(blockSize, blockSize * 2);
                     
                     // Add result using optimized loop (vectorizable)
                     for (let i = 0; i < blockSize; i++) {
                         ch1Output[i] += ch1Input[i]; // Add Ch1
                         ch2Output[i] += ch2Input[i]; // Add Ch2
                     }
                 } else if (processMode === 'single') {
                     const offset = singleChannelIndex * blockSize;
                     // Optimized: Use subarray view for better cache efficiency
                     const channelOutput = outputBuffer.subarray(offset, offset + blockSize);
                     
                     // Add result using optimized loop (vectorizable)
                     for (let i = 0; i < blockSize; i++) {
                         channelOutput[i] += finalResultBuffer[i];
                     }
                 }
             } else {
                 // Same input/output bus: Replace content in the output buffer
                 if (processMode === 'all') {
                     // If processing was done in-place (processingBuffer === outputBuffer) and result wasn't a new array,
                     // the outputBuffer is already updated.
                     // If a new buffer was returned by the plugin, copy it back.
                     if (finalResultBuffer !== outputBuffer) {
                         outputBuffer.set(finalResultBuffer);
                     }
                     // If requiresCopy was true (shouldn't be if inputBus === outputBus),
                     // this means tempBuffer was used, so copy finalResultBuffer back.
                     // This logic path needs careful review based on processor guarantees. Assuming direct modification or return.

                 } else if (processMode === 'pair') {
                     // Optimized: Copy the processed stereo pair using subarray views for better performance
                     const ch1Target = outputBuffer.subarray(pairStartChannel * blockSize, (pairStartChannel + 1) * blockSize);
                     const ch2Target = outputBuffer.subarray((pairStartChannel + 1) * blockSize, (pairStartChannel + 2) * blockSize);
                     
                     // Use set() for efficient block copy
                     ch1Target.set(finalResultBuffer.subarray(0, blockSize)); // Ch 1
                     ch2Target.set(finalResultBuffer.subarray(blockSize, blockSize * 2)); // Ch 2
                 } else if (processMode === 'single') {
                     // Optimized: Copy the processed mono channel using subarray view
                     const channelTarget = outputBuffer.subarray(singleChannelIndex * blockSize, (singleChannelIndex + 1) * blockSize);
                     channelTarget.set(finalResultBuffer);
                 }
             }


            // --- 9f. Handle Measurements & Message Throttling ---
            // Legacy JavaScript analyzers attach measurements to their result buffer.
            const measurements = result?.measurements;
            if (measurements) {
                const currentTimeMs = time * 1000;
                if (currentTimeMs - lastMessageTime >= MESSAGE_INTERVAL) {
                    // Drain queue first
                    if (messageQueue.size > 0) {
                        for (const [pluginId, data] of messageQueue) {
                            port.postMessage({ type: 'processBuffer', pluginId, ...data });
                        }
                        messageQueue.clear();
                    }
                    // Send current message immediately
                    port.postMessage({ type: 'processBuffer', pluginId: plugin.id, measurements });
                    lastMessageTime = currentTimeMs; // Update last sent time
                } else {
                    // Queue the message if interval hasn't passed
                    messageQueue.set(plugin.id, { measurements });
                }
                // Clear measurements after handling to avoid re-sending.
                result.measurements = null;
            }
        } // End of plugin processing loop

        // Update the instance's last message time state
        this.lastMessageTime = lastMessageTime;

        // --- 10. Final Output Generation ---
        const mainBusBuffer = busBuffers.get(0); // Get the final state of the main bus

        if (mainBusBuffer) {
            // Determine the number of channels to actually copy to the physical output
            const outputChannelsToWrite = Math.min(output.length, outputChannelCount);

            // Optimization: Clear only the channels we are about to write?
            // Safer: Clear all physical output channels to prevent stale data.
            for (let ch = 0; ch < output.length; ch++) {
                output[ch].fill(0);
            }

            // Copy the processed data from the main bus to the physical output buffers
            for (let ch = 0; ch < outputChannelsToWrite; ch++) {
                const srcOffset = ch * blockSize;
                // Defensive check: ensure source offset is within bounds
                if (srcOffset < mainBusBuffer.length) {
                    // Use subarray and set for efficient block copy
                    output[ch].set(mainBusBuffer.subarray(srcOffset, Math.min(srcOffset + blockSize, mainBusBuffer.length)));
                } else {
                    // This case indicates a mismatch between outputChannelCount and mainBusBuffer size.
                    // Output channel will already be zeroed from the loop above.
                    console.warn(`Source offset ${srcOffset} out of bounds for mainBusBuffer (length ${mainBusBuffer.length}) when writing output channel ${ch}.`);
                }
            }
        } else {
            // Should not happen if bus 0 is always initialized. Fallback: zero out physical output.
            console.error("Main bus (0) buffer not found at the end of processing!");
            for (let ch = 0; ch < output.length; ch++) {
                output[ch].fill(0);
            }
        }


        // --- 11. Output Level Monitoring ---
        // Same AC-only check as input monitoring (see section 4) so that a
        // constant DC offset on the output (e.g. introduced by Exciter with
        // a non-zero bias) does not block sleep mode entry.
        let hasOutputSignal = false;
        const outputChannelsToCheck = Math.min(output.length, outputChannelCount);
        const outAcThreshold = 2 * silenceThresholdAmplitude;
        for (let channel = 0; channel < outputChannelsToCheck; channel++) {
            const channelData = output[channel];
            let cmin = Infinity, cmax = -Infinity;
            for (let i = 0; i < channelData.length; i++) {
                const v = channelData[i];
                if (v < cmin) cmin = v;
                if (v > cmax) cmax = v;
                if (cmax - cmin > outAcThreshold) break; // early exit
            }
            if (cmax - cmin > outAcThreshold) {
                hasOutputSignal = true;
                break;
            }
        }

        // Update last output active time if signal detected
        if (hasOutputSignal) {
            audioLevelMonitoring.lastOutputActiveTime = time;
        }

        this.pumpDspTelemetry();

        // --- 12. Return Status ---
        // Return true to keep the processor alive
        return true;
    }
}

// Ensure the processor is registered with the correct name
try {
    registerProcessor('plugin-processor', PluginProcessor);
} catch (error) {
    console.error("Failed to register PluginProcessor:", error);
    // Fallback or error handling
}
