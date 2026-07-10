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

export class DspBindingError extends Error {
    constructor(message) {
        super(message);
        this.name = 'DspBindingError';
    }
}

export function createDspImports({
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

export class DspEngineBinding {
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

export async function instantiateDspBinding(moduleOrBytes, {
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

export { ET_OK, ET_ERR_STATE, REQUIRED_FUNCTION_EXPORTS };
